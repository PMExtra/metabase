import {
  restore,
  popover,
  filterWidget,
  visitEmbeddedPage,
} from "__support__/e2e/cypress";
import { SAMPLE_DATABASE } from "__support__/e2e/cypress_sample_database";

const { ORDERS, PEOPLE } = SAMPLE_DATABASE;

const query = `
SELECT orders.id, orders.product_id, orders.created_at AS production_date, orders.total, people.state, people.name, people.source
FROM orders LEFT JOIN people ON orders.user_id = people.id
WHERE true
  [[AND {{id}}]]
  [[AND orders.product_id = {{product_id}}]]
  [[AND {{created_at}}]]
  [[AND {{total}}]]
  [[AND {{state}}]]
  AND [[people.source = {{source}} --]] people.source IN ('Affiliate', 'Organic')
  LIMIT 15;
`;

const questionDetails = {
  name: "Native Quesiton With Multiple Filters - Embedding Test",
  description: "FooBar",
  native: {
    "template-tags": {
      id: {
        id: "d404e93f-8155-e990-ff57-37122547406c",
        name: "id",
        "display-name": "Order ID",
        type: "dimension",
        dimension: ["field", ORDERS.ID, null],
        "widget-type": "id",
        default: null,
      },
      created_at: {
        id: "a21ca6d2-f742-a94a-da71-75adf379069c",
        name: "created_at",
        "display-name": "Created At",
        type: "dimension",
        dimension: ["field", ORDERS.CREATED_AT, null],
        "widget-type": "date/quarter-year",
        default: null,
      },
      total: {
        id: "68350949-02cc-f540-86cf-ddcda07529d8",
        name: "total",
        "display-name": "Total",
        type: "dimension",
        dimension: ["field", ORDERS.TOTAL, null],
        "widget-type": "number/>=",
        default: [0],
        required: true,
      },
      source: {
        id: "44038e73-f909-1bed-0974-2a42ce8979e8",
        name: "source",
        "display-name": "Source",
        type: "text",
      },
      state: {
        id: "88057a9e-91bd-4b2e-9327-afd92c259dc8",
        name: "state",
        "display-name": "State",
        type: "dimension",
        dimension: ["field", PEOPLE.STATE, null],
        "widget-type": "string/!=",
        default: null,
      },
      product_id: {
        id: "c967d72e-3687-aa01-8c47-458f7905305f",
        name: "product_id",
        "display-name": "Product ID",
        type: "number",
        default: null,
      },
    },
    query,
    type: "native",
  },
};

describe("scenarios > embedding > native questions", () => {
  beforeEach(() => {
    restore();
    cy.signInAsAdmin();
  });

  context("UI", () => {
    beforeEach(() => {
      cy.createNativeQuestion(questionDetails, {
        visitQuestion: true,
      });

      enableSharing();
    });

    it("should not display disabled parameters", () => {
      publishChanges(({ request }) => {
        assert.deepEqual(request.body.embedding_params, {});
      });

      cy.document().then(doc => {
        const iframe = doc.querySelector("iframe");

        cy.signOut();
        cy.visit(iframe.src);
      });

      cy.contains("Lora Cronin");
      cy.contains("Organic");
      cy.contains("39.58");

      filterWidget().should("not.exist");
    });

    it("should display and work with enabled parameters while hiding the locked one", () => {
      setParameter("Order ID", "Editable");
      setParameter("Created At", "Editable");
      setParameter("Total", "Locked");
      setParameter("State", "Editable");
      setParameter("Product ID", "Editable");

      // We must enter a value for a locked parameter
      cy.findByText("Preview Locked Parameters")
        .parent()
        .within(() => {
          cy.findByText("Total").click();
        });

      // Total is greater than or equal to 0
      cy.findByPlaceholderText("Enter a number")
        .type("0")
        .blur();
      cy.button("Add filter").click();

      publishChanges(({ request }) => {
        const actual = request.body.embedding_params;

        const expected = {
          id: "enabled",
          created_at: "enabled",
          total: "locked",
          state: "enabled",
          product_id: "enabled",
        };

        assert.deepEqual(actual, expected);
      });

      cy.document().then(doc => {
        const iframe = doc.querySelector("iframe");

        cy.signOut();
        cy.visit(iframe.src);
      });

      cy.contains("Organic");
      cy.contains("Twitter").should("not.exist");

      // Created At: Q2, 2018
      filterWidget()
        .contains("Created At")
        .click();
      cy.findByTestId("select-button").click();
      popover()
        .contains("2018")
        .click();
      cy.findByText("Q2").click();

      // State: is not KS
      filterWidget()
        .contains("State")
        .click();
      cy.findByPlaceholderText("Search the list").type("KS");
      cy.findByTestId("KS-filter-value").click();
      cy.button("Add filter").click();

      cy.findByText("Logan Weber").should("not.exist");

      // Product ID is 10
      cy.findByPlaceholderText("Product ID").type("10{enter}");

      cy.contains("Affiliate").should("not.exist");

      // Let's try to remove one filter
      cy.findByText("Q2, 2018")
        .siblings(".Icon-close")
        .click();

      // Order ID is 926 - there should be only one result after this
      filterWidget()
        .contains("Order ID")
        .click();
      cy.findByPlaceholderText("Enter an ID").type("926");
      cy.button("Add filter").click();

      cy.findByTestId("table-row").should("have.length", 1);

      cy.findByText("December 29, 2018, 4:54 AM");
      cy.findByText("CO");
      cy.findByText("Sid Mills").should("not.exist");

      cy.location("search").should("eq", "?id=926&state=KS&product_id=10");
    });
  });

  context("API", () => {
    beforeEach(() => {
      cy.createNativeQuestion(questionDetails, {
        wrapId: true,
      });
    });

    it("should hide filters via url", () => {
      cy.get("@questionId").then(questionId => {
        cy.request("PUT", `/api/card/${questionId}`, {
          enable_embedding: true,
          embedding_params: {
            id: "enabled",
            product_id: "enabled",
            state: "enabled",
            created_at: "enabled",
            total: "enabled",
          },
        });

        const payload = {
          resource: { question: questionId },
          params: {},
        };

        // It should be possible to both set the filter value and hide it at the same time.
        // That's the synonymous to the locked filter.
        visitEmbeddedPage(payload, {
          setFilters: "id=92",
          hideFilters: "id,product_id,state,created_at,total",
        });

        cy.findByTestId("table-row").should("have.length", 1);
        cy.findByText("92");

        filterWidget().should("not.exist");
      });
    });

    it("should set multiple filter values via url", () => {
      cy.get("@questionId").then(questionId => {
        cy.request("PUT", `/api/card/${questionId}`, {
          enable_embedding: true,
          embedding_params: {
            created_at: "enabled",
            source: "enabled",
            state: "enabled",
            total: "enabled",
          },
        });

        const payload = {
          resource: { question: questionId },
          params: {},
        };

        visitEmbeddedPage(payload, {
          setFilters: "created_at=Q2-2019&source=Organic&state=OR",
        });

        filterWidget()
          .should("have.length", 4)
          .and("contain", "OR")
          .and("contain", "Q2, 2019");
        // Why do we use input field in one filter widget but a simple `span` in the other one?
        cy.findByDisplayValue("Organic");

        // Total's value should fall back to the default one (`0`) because we didn't set it explicitly
        cy.get("legend")
          .contains("Total")
          .parent("fieldset")
          .contains("0");

        cy.contains("Emilie Goyette");
        cy.contains("35.7");

        // OTOH, we should also be able to override the default filter value by eplixitly setting it
        visitEmbeddedPage(payload, {
          setFilters: "total=80",
        });

        cy.get("legend")
          .contains("Total")
          .parent("fieldset")
          .contains("80");

        cy.contains("35.7").should("not.exist");
      });
    });

    it("should lock all parameters", () => {
      cy.get("@questionId").then(questionId => {
        cy.request("PUT", `/api/card/${questionId}`, {
          enable_embedding: true,
          embedding_params: {
            id: "locked",
            product_id: "locked",
            state: "locked",
            created_at: "locked",
            total: "locked",
            source: "locked",
          },
        });

        const payload = {
          resource: { question: questionId },
          params: {
            id: [92, 96, 102, 104],
            product_id: [140],
            state: ["AK", "TX"],
            created_at: "Q3-2018",
            total: [10],
            source: ["Organic"],
          },
        };

        visitEmbeddedPage(payload);

        cy.findByTestId("table-row").should("have.length", 1);
        cy.findByText("66.8");

        filterWidget().should("not.exist");
      });
    });
  });
});

function setParameter(name, filter) {
  cy.findByText("Which parameters can users of this embed use?")
    .parent()
    .within(() => {
      cy.findByText(name)
        .siblings("a")
        .click();
    });

  popover()
    .contains(filter)
    .click();
}

function enableSharing() {
  cy.intercept("GET", "/api/session/properties").as("sessionProperties");

  cy.icon("share").click();
  cy.findByText("Embed this question in an application").click();
  cy.wait("@sessionProperties");
}

function publishChanges(callback) {
  cy.intercept("PUT", "/api/card/*").as("publishChanges");

  cy.button("Publish").click();

  cy.wait(["@publishChanges", "@publishChanges"]).then(xhrs => {
    // Unfortunately, the order of requests is not always the same.
    // Therefore, we must first get the one that has the `embedding_params` and then assert on it.
    const targetXhr = xhrs.find(({ request }) =>
      Object.keys(request.body).includes("embedding_params"),
    );

    callback && callback(targetXhr);
  });
}
