import {
  restore,
  getDimensionByName,
  visitQuestionAdhoc,
  popover,
  summarize,
} from "__support__/e2e/cypress";

import { SAMPLE_DB_ID } from "__support__/e2e/cypress_data";
import { SAMPLE_DATABASE } from "__support__/e2e/cypress_sample_database";

const {
  ORDERS,
  ORDERS_ID,
  PRODUCTS,
  PRODUCTS_ID,
  PEOPLE,
  PEOPLE_ID,
} = SAMPLE_DATABASE;

describe("scenarios > x-rays", () => {
  beforeEach(() => {
    restore();
    cy.signInAsAdmin();
  });

  it.skip("should work on questions with explicit joins (metabase#13112)", () => {
    const PRODUCTS_ALIAS = "Products";

    cy.createQuestion(
      {
        name: "13112",
        query: {
          "source-table": ORDERS_ID,
          joins: [
            {
              fields: "all",
              "source-table": PRODUCTS_ID,
              condition: [
                "=",
                ["field", ORDERS.PRODUCT_ID, null],
                ["field", PRODUCTS.ID, { "join-alias": PRODUCTS_ALIAS }],
              ],
              alias: PRODUCTS_ALIAS,
            },
          ],
          aggregation: [["count"]],
          breakout: [
            ["field", ORDERS.CREATED_AT, { "temporal-unit": "month" }],
            ["field", PRODUCTS.CATEGORY, { "join-alias": PRODUCTS_ALIAS }],
          ],
        },
        display: "line",
      },
      { visitQuestion: true },
    );

    cy.intercept("POST", "/api/dataset").as("dataset");

    cy.get(".dot")
      .eq(23) // Random dot
      .click({ force: true });
    cy.findByText("X-ray").click();

    // x-rays take long time even locally - that can timeout in CI so we have to extend it
    cy.wait("@dataset", { timeout: 30000 });
    cy.findByText(
      "A closer look at number of Orders where Created At is in March 2018 and Category is Gadget",
    );
    cy.icon("warning").should("not.exist");
  });

  ["X-ray", "Compare to the rest"].forEach(action => {
    it(`"${action.toUpperCase()}" should work on a nested question made from base native question (metabase#15655)`, () => {
      // TODO: Remove this when #15655 gets fixed
      cy.skipOn(action === "Compare to the rest");

      cy.intercept("GET", "/api/automagic-dashboards/**").as("xray");

      cy.createNativeQuestion({
        name: "15655",
        native: { query: "select * from people" },
      });

      cy.visit("/question/new");
      cy.findByText("Simple question").click();
      cy.findByText("Saved Questions").click();
      cy.findByText("15655").click();
      summarize();
      getDimensionByName({ name: "SOURCE" }).click();
      cy.button("Done").click();
      cy.get(".bar")
        .first()
        .click({ force: true });
      cy.findByText(action).click();

      cy.wait("@xray").then(xhr => {
        expect(xhr.response.body.cause).not.to.exist;
        expect(xhr.response.statusCode).not.to.eq(500);
      });

      cy.findByRole("heading", { name: /^A closer look at the number of/ });
      cy.get(".DashCard");
    });

    it(`"${action.toUpperCase()}" should not show NULL in titles of generated dashboard cards (metabase#15737)`, () => {
      cy.intercept("GET", "/api/automagic-dashboards/**").as("xray");
      visitQuestionAdhoc({
        name: "15737",
        dataset_query: {
          database: SAMPLE_DB_ID,
          query: {
            "source-table": PEOPLE_ID,
            aggregation: [["count"]],
            breakout: [["field", PEOPLE.SOURCE, null]],
          },
          type: "query",
        },
        display: "bar",
      });

      cy.get(".bar")
        .first()
        .click();
      cy.findByText(action).click();
      cy.wait("@xray");
      cy.contains("null").should("not.exist");
    });
  });

  it("should be able to save an x-ray as a dashboard and visit it immediately (metabase#18028)", () => {
    cy.intercept("GET", "/app/assets/geojson/**").as("geojson");

    cy.visit(`/auto/dashboard/table/${ORDERS_ID}`);

    cy.wait("@geojson", { timeout: 10000 });

    cy.button("Save this").click();

    cy.findByText("Your dashboard was saved");
    cy.findByText("See it").click();

    cy.url().should("contain", "a-look-at-your-orders-table");

    cy.get(".Card").contains("18,760");
    cy.findByText("How these transactions are distributed");
  });

  it("should be able to click the title of an x-ray dashcard to see it in the query builder (metabase#19405)", () => {
    const timeout = { timeout: 10000 };

    cy.visit(`/auto/dashboard/table/${ORDERS_ID}`);

    // confirm results of "Total transactions" card are present
    cy.findByText("18,760", timeout);
    cy.findByText("Total transactions").click();

    // confirm we're in the query builder with the same results
    cy.url().should("contain", "/question");
    cy.findByText("18,760");

    cy.go("back");

    // add a parameter filter to the auto dashboard
    cy.findByText("State", timeout).click();
    popover().within(() => {
      cy.findByPlaceholderText("Search the list").type("GA{enter}");
      cy.findByText("GA").click();
      cy.findByText("Add filter").click();
    });

    // confirm results of "Total transactions" card were updated
    cy.findByText("463", timeout);
    cy.findByText("Total transactions").click();

    // confirm parameter filter is applied as filter in query builder
    cy.findByText("State is GA");
    cy.findByText("463");
  });
});
