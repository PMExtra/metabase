(ns metabase.driver.common.parameters.dates
  "Shared code for handling datetime parameters, used by both MBQL and native params implementations."
  (:require [java-time :as t]
            [medley.core :as m]
            [metabase.mbql.schema :as mbql.s]
            [metabase.mbql.util :as mbql.u]
            [metabase.models.params :as params]
            [metabase.query-processor.error-type :as error-type]
            [metabase.util.date-2 :as u.date]
            [metabase.util.i18n :refer [tru]]
            [metabase.util.schema :as su]
            [schema.core :as s])
  (:import java.time.temporal.Temporal))

(s/defn date-type?
  "Is param type `:date` or some subtype like `:date/month-year`?"
  [param-type :- s/Keyword]
  (= (get-in mbql.s/parameter-types [param-type :type]) :date))

(defn date-range-type?
  "Does date `param-type` represent a range of dates, rather than a single absolute date? (The value may be relative,
  such as `past30days`, or absolute, such as `2020-01`.)"
  [param-type]
  (and (date-type? param-type)
       (not (#{:date/single :date} param-type))))

;; Both in MBQL and SQL parameter substitution a field value is compared to a date range, either relative or absolute.
;; Currently the field value is casted to a day (ignoring the time of day), so the ranges should have the same
;; granularity level.
;;
;; See https://github.com/metabase/metabase/pull/4607#issuecomment-290884313 how we could support
;; hour/minute granularity in field parameter queries.

(defn- day-range
  [start end]
  {:start start, :end end})

(defn- comparison-range
  ([t unit]
   (comparison-range t t unit :day))

  ([start end unit]
   (comparison-range start end unit :day))

  ([start end unit resolution]
   (merge
    (u.date/comparison-range start unit :>= {:resolution resolution})
    (u.date/comparison-range end   unit :<= {:resolution resolution, :end :inclusive}))))

(defn- second-range
  [start end]
  (comparison-range start end :second :second))

(defn- minute-range
  [start end]
  (comparison-range start end :minute :minute))

(defn- hour-range
  [start end]
  (comparison-range start end :hour :hour))

(defn- week-range [start end]
  (comparison-range start end :week))

(defn- month-range [start end]
  (comparison-range start end :month))

(defn- year-range [start end]
  (comparison-range start end :year))

(defn- quarter-range
  [quarter year]
  (let [year-quarter (t/year-quarter year (case quarter
                                            "Q1" 1
                                            "Q2" 2
                                            "Q3" 3
                                            "Q4" 4))]
    {:start (.atDay year-quarter 1)
     :end   (.atEndOfQuarter year-quarter)}))

(def ^:private operations-by-date-unit
  {"second" {:unit-range second-range
             :to-period  t/seconds}
   "minute" {:unit-range minute-range
             :to-period  t/minutes}
   "hour"   {:unit-range hour-range
             :to-period  t/hours}
   "day"    {:unit-range day-range
             :to-period  t/days}
   "week"   {:unit-range week-range
             :to-period  t/weeks}
   "month"  {:unit-range month-range
             :to-period  t/months}
   "year"   {:unit-range year-range
             :to-period  t/years}})

(defn- maybe-reduce-resolution [unit dt]
  (if
    (contains? #{"second" "minute" "hour"} unit)
    dt
    ; for units that are a day or longer, convert back to LocalDate
    (t/local-date dt)))

;;; +----------------------------------------------------------------------------------------------------------------+
;;; |                                              DATE STRING DECODERS                                              |
;;; +----------------------------------------------------------------------------------------------------------------+

;; For parsing date strings and producing either a date range (for raw SQL parameter substitution) or a MBQL clause

(defn- expand-parser-groups
  [group-label group-value]
  (case group-label
    :unit (conj (seq (get operations-by-date-unit group-value))
                [group-label group-value])
    :int-value [[group-label (Integer/parseInt group-value)]]
    (:date :date-1 :date-2) [[group-label (u.date/parse group-value)]]
    [[group-label group-value]]))

(s/defn ^:private regex->parser :- (s/pred fn?)
  "Takes a regex and labels matching the regex capturing groups. Returns a parser which takes a parameter value,
  validates the value against regex and gives a map of labels and group values. Respects the following special label
  names:

      :unit – finds a matching date unit and merges date unit operations to the result
      :int-value – converts the group value to integer
      :date, :date1, date2 – converts the group value to absolute date"
  [regex :- java.util.regex.Pattern group-labels]
  (fn [param-value]
    (when-let [regex-result (re-matches regex param-value)]
      (into {} (mapcat expand-parser-groups group-labels (rest regex-result))))))

;; Decorders consist of:
;; 1) Parser which tries to parse the date parameter string
;; 2) Range decoder which takes the parser output and produces a date range relative to the given datetime
;; 3) Filter decoder which takes the parser output and produces a mbql clause for a given mbql field reference

(def ^:private relative-temporal-units-regex #"(millisecond|second|minute|hour|day|week|month|quarter|year)")
(def ^:private include-current-regex         #"(~?)")

(def ^:private relative-date-string-decoders
  [{:parser #(= % "today")
    :range  (fn [_ dt]
              (let [dt-res (t/local-date dt)]
                {:start dt-res,
                 :end   dt-res}))
    :filter (fn [_ field-clause]
              [:= (mbql.u/with-temporal-unit field-clause :day) [:relative-datetime :current]])}

   {:parser #(= % "yesterday")
    :range  (fn [_ dt]
              (let [dt-res (t/local-date dt)]
                {:start (t/minus dt-res (t/days 1))
                 :end   (t/minus dt-res (t/days 1))}))
    :filter (fn [_ field-clause]
              [:= (mbql.u/with-temporal-unit field-clause :day) [:relative-datetime -1 :day]])}

   ;; adding a tilde (~) at the end of a past<n><unit> filter means we should include the current day/etc.
   ;; e.g. past30days  = past 30 days, not including partial data for today ({:include-current false})
   ;;      past30days~ = past 30 days, *including* partial data for today   ({:include-current true})
   {:parser (regex->parser (re-pattern (str #"past([0-9]+)" relative-temporal-units-regex #"s" include-current-regex))
                           [:int-value :unit :include-current?])
    :range  (fn [{:keys [unit int-value unit-range to-period include-current?]} dt]
              (let [dt-res (maybe-reduce-resolution unit dt)]
                (unit-range (t/minus dt-res (to-period int-value))
                            (t/minus dt-res (to-period (if (seq include-current?) 0 1))))))
    :filter (fn [{:keys [unit int-value include-current?]} field-clause]
              [:time-interval field-clause (- int-value) (keyword unit) {:include-current (boolean (seq include-current?))}])}

   {:parser (regex->parser (re-pattern (str #"next([0-9]+)" relative-temporal-units-regex #"s" include-current-regex))
                           [:int-value :unit :include-current?])
    :range  (fn [{:keys [unit int-value unit-range to-period include-current?]} dt]
              (let [dt-res (maybe-reduce-resolution unit dt)]
                (unit-range (t/plus dt-res (to-period (if (seq include-current?) 0 1)))
                            (t/plus dt-res (to-period int-value)))))
    :filter (fn [{:keys [unit int-value include-current?]} field-clause]
              [:time-interval field-clause int-value (keyword unit) {:include-current (boolean (seq include-current?))}])}

   {:parser (regex->parser (re-pattern (str #"last" relative-temporal-units-regex))
                           [:unit])
    :range  (fn [{:keys [unit unit-range to-period]} dt]
              (let [last-unit (t/minus (maybe-reduce-resolution unit dt) (to-period 1))]
                (unit-range last-unit last-unit)))
    :filter (fn [{:keys [unit]} field-clause]
              [:time-interval field-clause :last (keyword unit)])}

   {:parser (regex->parser (re-pattern (str #"this" relative-temporal-units-regex))
                           [:unit])
    :range  (fn [{:keys [unit unit-range]} dt]
              (let [dt-adj (maybe-reduce-resolution unit dt)]
                (unit-range dt-adj dt-adj)))
    :filter (fn [{:keys [unit]} field-clause]
              [:time-interval field-clause :current (keyword unit)])}])

(defn- ->iso-8601-date [t]
  (t/format :iso-local-date t))

;; TODO - using `range->filter` so much below seems silly. Why can't we just bucket the field and use `:=` clauses?
(defn- range->filter
  [{:keys [start end]} field-clause]
  [:between (mbql.u/with-temporal-unit field-clause :day) (->iso-8601-date start) (->iso-8601-date end)])

(def ^:private absolute-date-string-decoders
  ;; year and month
  [{:parser (regex->parser #"([0-9]{4}-[0-9]{2})" [:date])
    :range  (fn [{:keys [date]} _]
              (month-range date date))
    :filter (fn [{:keys [date]} field-clause]
              (range->filter (month-range date date) field-clause))}
   ;; quarter year
   {:parser (regex->parser #"(Q[1-4]{1})-([0-9]{4})" [:quarter :year])
    :range  (fn [{:keys [quarter year]} _]
              (quarter-range quarter (Integer/parseInt year)))
    :filter (fn [{:keys [quarter year]} field-clause]
              (range->filter (quarter-range quarter (Integer/parseInt year))
                             field-clause))}
   ;; single day
   {:parser (regex->parser #"([0-9-T:]+)" [:date])
    :range  (fn [{:keys [date]} _]
              {:start date, :end date})
    :filter (fn [{:keys [date]} field-clause]
              (let [iso8601date (->iso-8601-date date)]
                [:= (mbql.u/with-temporal-unit field-clause :day) iso8601date]))}
   ;; day range
   {:parser (regex->parser #"([0-9-T:]+)~([0-9-T:]+)" [:date-1 :date-2])
    :range  (fn [{:keys [date-1 date-2]} _]
              {:start date-1, :end date-2})
    :filter (fn [{:keys [date-1 date-2]} field-clause]
              [:between (mbql.u/with-temporal-unit field-clause :day) (->iso-8601-date date-1) (->iso-8601-date date-2)])}
   ;; before day
   {:parser (regex->parser #"~([0-9-T:]+)" [:date])
    :range  (fn [{:keys [date]} _]
              {:end date})
    :filter (fn [{:keys [date]} field-clause]
              [:< (mbql.u/with-temporal-unit field-clause :day) (->iso-8601-date date)])}
   ;; after day
   {:parser (regex->parser #"([0-9-T:]+)~" [:date])
    :range  (fn [{:keys [date]} _]
              {:start date})
    :filter (fn [{:keys [date]} field-clause]
              [:> (mbql.u/with-temporal-unit field-clause :day) (->iso-8601-date date)])}])

(def ^:private all-date-string-decoders
  (concat relative-date-string-decoders absolute-date-string-decoders))

(s/defn ^:private execute-decoders
  "Returns the first successfully decoded value, run through both parser and a range/filter decoder depending on
  `decoder-type`. This generates an *inclusive* range by default. The range is adjusted to be exclusive as needed: see
  dox for [[date-string->range]] for more details."
  [decoders, decoder-type :- (s/enum :range :filter), decoder-param, date-string :- s/Str]
  (some (fn [{parser :parser, parser-result-decoder decoder-type}]
          (when-let [parser-result (parser date-string)]
            (parser-result-decoder parser-result decoder-param)))
        decoders))

(def ^:private TemporalRange
  {(s/optional-key :start) Temporal, (s/optional-key :end) Temporal})

(s/defn ^:private adjust-inclusive-range-if-needed :- (s/maybe TemporalRange)
  "Make an inclusive date range exclusive as needed."
  [{:keys [inclusive-start? inclusive-end?]}, {:keys [start end]} :- (s/maybe TemporalRange)]
  (merge
   (when start
     {:start (if inclusive-start?
               start
               (u.date/add start :day -1))})
   (when end
     {:end (if inclusive-end?
             end
             (u.date/add end :day 1))})))

(def ^:private DateStringRange
  "Schema for a valid date range returned by `date-string->range`."
  (-> {(s/optional-key :start) s/Str, (s/optional-key :end) s/Str}
      (s/constrained seq
                     "must have either :start or :end")
      (s/constrained (fn [{:keys [start end]}]
                       (or (not start)
                           (not end)
                           (not (pos? (compare start end)))))
                     ":start must not come after :end")
      (s/named "valid date range")))

(s/defn date-string->range :- DateStringRange
  "Takes a string description of a date range such as `lastmonth` or `2016-07-15~2016-08-6` and returns a map with
  `:start` and/or `:end` keys, as ISO-8601 *date* strings. By default, `:start` and `:end` are inclusive, e.g.

    (date-string->range \"past2days\") ; -> {:start \"2020-01-20\", :end \"2020-01-21\"}

  intended for use with SQL like

    WHERE date(some_column) BETWEEN date '2020-01-20' AND date '2020-01-21'

  which is *INCLUSIVE*. If the filter clause you're generating is not inclusive, pass the `:inclusive-start?` or
  `:inclusive-end?` options as needed to generate an appropriate range.

  Note that some ranges are open-ended on one side, and will have only a `:start` or an `:end`."
  ;; 1-arg version returns inclusive start/end; 2-arg version can adjust as needed
  ([date-string]
   (date-string->range date-string nil))

  ([date-string  :- s/Str {:keys [inclusive-start? inclusive-end?]
                           :or   {inclusive-start? true, inclusive-end? true}}]
   (let [options {:inclusive-start? inclusive-start?, :inclusive-end? inclusive-end?}
         now (t/local-date-time)]
     ;; Relative dates respect the given time zone because a notion like "last 7 days" might mean a different range of
     ;; days depending on the user timezone
     (or (->> (execute-decoders relative-date-string-decoders :range now date-string)
              (adjust-inclusive-range-if-needed options)
              (m/map-vals u.date/format))
         ;; Absolute date ranges don't need the time zone conversion because in SQL the date ranges are compared
         ;; against the db field value that is casted granularity level of a day in the db time zone
         (->> (execute-decoders absolute-date-string-decoders :range nil date-string)
              (adjust-inclusive-range-if-needed options)
              (m/map-vals u.date/format))
         ;; if both of the decoders above fail, then the date string is invalid
         (throw (ex-info (tru "Don''t know how to parse date param ''{0}'' — invalid format" date-string)
                         {:param date-string
                          :type  error-type/invalid-parameter}))))))

(s/defn date-string->filter :- mbql.s/Filter
  "Takes a string description of a *date* (not datetime) range such as 'lastmonth' or '2016-07-15~2016-08-6' and
   returns a corresponding MBQL filter clause for a given field reference."
  [date-string :- s/Str field :- (s/cond-pre su/IntGreaterThanZero mbql.s/Field)]
  (or (execute-decoders all-date-string-decoders :filter (params/wrap-field-id-if-needed field) date-string)
      (throw (ex-info (tru "Don''t know how to parse date string {0}" (pr-str date-string))
                      {:type        error-type/invalid-parameter
                       :date-string date-string}))))
