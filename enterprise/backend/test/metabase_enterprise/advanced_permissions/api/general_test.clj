(ns metabase-enterprise.advanced-permissions.api.general-test
  (:require [clojure.test :refer :all]
            [metabase.models :refer [PermissionsGroup]]
            [metabase.models.permissions-group :as group]
            [metabase.public-settings.premium-features-test :as premium-features-test]
            [metabase.test :as mt]))

(deftest general-permissions-test
  (mt/with-temp* [PermissionsGroup [{group-id :id}]]
    (testing "GET /api/ee/advanced-permissions/general/graph"
      (premium-features-test/with-premium-features #{}
        (testing "Should require a token with `:advanced-permissions`"
          (is (= "This API endpoint is only enabled if you have a premium token with the :advanced-permissions feature."
                 (mt/user-http-request :crowberto :get 402 "ee/advanced-permissions/general/graph")))))

      (premium-features-test/with-premium-features #{:advanced-permissions}
        (testing "have to be a superuser"
          (is (= "You don't have permissions to do that."
                 (mt/user-http-request :rasta :get 403 "ee/advanced-permissions/general/graph"))))

        (testing "return general permissions for groups that has general permisions"
          (let [graph  (mt/user-http-request :crowberto :get 200 "ee/advanced-permissions/general/graph")
                groups (:groups graph)]
            (is (int? (:revision graph)))
            (is (partial= {(:id (group/admin))
                           {:monitoring   "yes"
                            :setting      "yes"
                            :subscription "yes"}
                           (:id (group/all-users))
                           {:monitoring   "no"
                            :setting      "no"
                            :subscription "yes"}}
                          groups)))))))

  (mt/with-temp* [PermissionsGroup [{group-id :id}]]
    (testing "PUT /api/ee/advanced-permissions/general/graph"
      (let [current-graph (premium-features-test/with-premium-features #{:advanced-permissions}
                            (mt/user-http-request :crowberto :get 200 "ee/advanced-permissions/general/graph"))
            new-graph     (assoc-in current-graph [:groups group-id :setting] "yes")]

        (premium-features-test/with-premium-features #{}
          (testing "Should require a token with `:advanced-permissions`"
            (is (= "This API endpoint is only enabled if you have a premium token with the :advanced-permissions feature."
                   (mt/user-http-request :crowberto :put 402 "ee/advanced-permissions/general/graph" new-graph)))))

        (premium-features-test/with-premium-features #{:advanced-permissions}
          (testing "have to be a superuser"
            (is (= "You don't have permissions to do that."
                   (mt/user-http-request :rasta :put 403 "ee/advanced-permissions/general/graph" new-graph))))

          (testing "failed when revision is mismatched"
            (is (= "Looks like someone else edited the permissions and your data is out of date. Please fetch new data and try again."
                   (mt/user-http-request :crowberto :put 409 "ee/advanced-permissions/general/graph"
                                         (assoc new-graph :revision (inc (:revision new-graph)))))))

          (testing "successfully update general permissions"
            (is (partial= {(:id (group/admin))
                           {:monitoring   "yes"
                            :setting      "yes"
                            :subscription "yes"}
                           group-id
                           {:monitoring   "no"
                            :setting      "yes"
                            :subscription "no"}}
                          (:groups (mt/user-http-request :crowberto :put 200 "ee/advanced-permissions/general/graph" new-graph))))))))))

(deftest current-user-test
  (testing "GET /api/user/current returns additional fields if advanced-permissions is enabled"
    (premium-features-test/with-premium-features #{:advanced-permissions}
      (letfn [(user-general-permissions [user]
                (-> (mt/user-http-request user :get 200 "user/current")
                    :permissions))]
        (testing "admins should have full general permisions"
          (is (= {:can_access_setting true
                  :can_access_subscription true
                  :can_access_monitoring true}
                 (user-general-permissions :crowberto))))

        (testing "non-admin users should only have subscriptions enabled"
          (is (= {:can_access_setting false
                  :can_access_subscription true
                  :can_access_monitoring false}
                 (user-general-permissions :rasta))))))))
