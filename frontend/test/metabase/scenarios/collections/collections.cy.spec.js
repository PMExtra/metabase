import _ from "underscore";
import {
  restore,
  modal,
  popover,
  openOrdersTable,
  navigationSidebar,
  closeNavigationSidebar,
  openNavigationSidebar,
} from "__support__/e2e/cypress";
import { displaySidebarChildOf } from "./helpers/e2e-collections-sidebar.js";
import { USERS, USER_GROUPS } from "__support__/e2e/cypress_data";

const { nocollection } = USERS;
const { DATA_GROUP } = USER_GROUPS;

// Z because the api lists them alphabetically by name, so it makes it easier to check
const [admin, collection, sub_collection] = [
  {
    name: "Robert Tableton's Personal Collection",
    id: 1,
  },
  {
    name: "Z Collection",
    id: null, // TBD from a response body
  },
  {
    name: "ZZ Sub-Collection",
    id: null, // TBD from a response body
  },
];

const dashboard_name = "Test Dashboard";

describe("scenarios > collection_defaults", () => {
  describe("for admins", () => {
    beforeEach(() => {
      restore();
      cy.signInAsAdmin();
    });

    describe("new collections", () => {
      beforeEach(() => {
        cy.log("Create new collection");
        cy.request("POST", "/api/collection", {
          name: collection.name,
          color: "#ff9a9a",
        }).then(({ body }) => {
          collection.id = body.id;
        });
      });

      it("should be the parent collection", () => {
        const LENGTH = collection.id + 1;
        cy.request("GET", "/api/collection").then(response => {
          expect(response.body).to.have.length(LENGTH);
          expect(response.body[collection.id].name).to.equal(collection.name);
          // Check that it has no parent
          expect(response.body[collection.id].location).to.equal("/");
        });
      });

      it("should be visible within a root collection in a sidebar", () => {
        cy.visit("/collection/root");
        cy.findByText(collection.name);
      });

      describe("a new sub-collection", () => {
        beforeEach(() => {
          cy.log(
            "Create a sub collection within previously created collection",
          );
          cy.request("POST", "/api/collection", {
            name: sub_collection.name,
            color: "#ff9a9a",
            parent_id: collection.id,
          }).then(({ body }) => {
            sub_collection.id = body.id;
          });
        });
        it("should be a sub collection", () => {
          const LENGTH = sub_collection.id + 1;
          cy.request("GET", "/api/collection").then(response => {
            expect(response.body).to.have.length(LENGTH);
            expect(response.body[sub_collection.id].name).to.equal(
              sub_collection.name,
            );
            // Check that it has a parent (and that it is a "Z collection")
            expect(response.body[sub_collection.id].location).to.equal(
              `/${collection.id}/`,
            );
          });
        });

        it("should be nested under parent on a parent's URL in a sidebar", () => {
          cy.visit("/collection/root");
          cy.findByText(sub_collection.name).should("not.exist");

          cy.visit(`/collection/${collection.id}`);
          cy.findByText(sub_collection.name);
        });

        it("should be moved under admin's personal collection", () => {
          cy.request("PUT", `/api/collection/${sub_collection.id}`, {
            parent_id: admin.id,
          });

          cy.visit(`/collection/${admin.id}`);
          // this changed in 0.38
          // It used to be "Robert Tableton's personal collection"
          // but since we're logged in as admin, it's showing "Your personal collection"
          cy.findByText(sub_collection.name);
        });
      });
    });

    describe("sidebar behavior", () => {
      beforeEach(() => {
        restore();
        cy.signInAsAdmin();
      });

      it("should allow a user to expand a collection without navigating to it", () => {
        cy.visit("/collection/root");
        // 1. click on the chevron to expand the sub collection
        displaySidebarChildOf("First collection");
        // 2. I should see the nested collection name
        cy.findByText("First collection");
        cy.findByText("Second collection");
        // 3. The url should still be /collection/root to test that we haven't navigated away
        cy.location("pathname").should("eq", "/collection/root");
        //
      });

      it.skip("should expand/collapse collection tree by clicking on parent collection name (metabse#17339)", () => {
        cy.visit("/collection/root");

        navigationSidebar().within(() => {
          cy.findByText("First collection").click();
          cy.findByText("Second collection");
          cy.findByText("Third collection");

          // Warning: There have been some race conditions with the re-rendering in the collection sidebar observed previously.
          //          Double check that this test works as expected when the underlying issue is fixed. Update as needed.
          cy.findByText("First collection").click();
          cy.findByText("Second collection").should("not.exist");
        });
      });

      describe("deeply nested collection navigation", () => {
        it("should correctly display deep nested collections", () => {
          cy.request("GET", "/api/collection").then(xhr => {
            // We need its ID to continue nesting below it
            const { id: THIRD_COLLECTION_ID } = xhr.body.find(
              collection => collection.slug === "third_collection",
            );

            cy.log("Create two more nested collections");
            [
              "Fourth collection",
              "Fifth collection with a very long name",
            ].forEach((collection, index) => {
              cy.request("POST", "/api/collection", {
                name: collection,
                parent_id: THIRD_COLLECTION_ID + index,
                color: "#509ee3",
              });
            });
          });
          cy.visit("/collection/root");
          // 1. Expand out via the chevrons so that all collections are showing
          displaySidebarChildOf("First collection");
          displaySidebarChildOf("Second collection");
          displaySidebarChildOf("Third collection");
          displaySidebarChildOf("Fourth collection");
          // 2. Ensure we can see the entire "Fifth level with a long name" collection text
          cy.findByText("Fifth collection with a very long name");
        });
      });
    });

    describe("a new dashboard", () => {
      it("should be in the root collection", () => {
        // Make new dashboard and check collection name
        cy.createDashboard({ name: dashboard_name });

        cy.visit("/collection/root");
        cy.findByText(dashboard_name);
      });
    });
  });

  describe("for users", () => {
    beforeEach(() => {
      restore();
      cy.signInAsNormalUser();
    });

    describe("a new dashboard", () => {
      it("should be in the root collection", () => {
        // Make new dashboard and check collection name
        cy.createDashboard({ name: dashboard_name });

        cy.visit("/collection/root");
        cy.findByText(dashboard_name);
      });
    });
  });

  describe("Collection related issues reproductions", () => {
    beforeEach(() => {
      restore();
      cy.signInAsAdmin();
    });

    describe("nested collections with revoked parent access", () => {
      const { first_name, last_name } = nocollection;
      const revokedUsersPersonalCollectionName = `${first_name} ${last_name}'s Personal Collection`;

      beforeEach(() => {
        // Create Parent collection within `Our analytics`
        cy.request("POST", "/api/collection", {
          name: "Parent",
          color: "#509EE3",
          parent_id: null,
        }).then(({ body: { id: PARENT_COLLECTION_ID } }) => {
          // Create Child collection within Parent collection
          cy.request("POST", "/api/collection", {
            name: "Child",
            color: "#509EE3",
            parent_id: PARENT_COLLECTION_ID,
          }).then(({ body: { id: CHILD_COLLECTION_ID } }) => {
            // Fetch collection permission graph
            cy.request("GET", "/api/collection/graph").then(
              ({ body: { groups, revision } }) => {
                // Give `Data` group permission to "curate" Child collection only
                // Access to everything else is revoked by default - that's why we chose `Data` group
                groups[DATA_GROUP][CHILD_COLLECTION_ID] = "write";

                // We're chaining these 2 requestes in order to match shema (passing it from GET to PUT)
                // Similar to what we did in `sandboxes.cy.spec.js` with the permission graph
                cy.request("PUT", "/api/collection/graph", {
                  // Pass previously mutated `groups` object
                  groups,
                  revision,
                });
              },
            );
          });
        });

        cy.signOut();
        cy.signIn("nocollection");
      });

      it("should not render collections in items list if user doesn't have collection access (metabase#16555)", () => {
        cy.visit("/collection/root");
        // Since this user doesn't have access rights to the root collection, it should render empty
        cy.findByTestId("collection-empty-state");
      });

      it("should see a child collection in a sidebar even with revoked access to its parent (metabase#14114)", () => {
        cy.visit("/");

        navigationSidebar().within(() => {
          cy.findByText("Our analytics").click();
        });

        navigationSidebar().within(() => {
          cy.findByText("Our analytics");
          cy.findByText("Child");
          cy.findByText("Parent").should("not.exist");
          cy.findByText("Your personal collection");
        });
      });

      it.skip("should be able to choose a child collection when saving a question (metabase#14052)", () => {
        openOrdersTable();
        cy.findByText("Save").click();
        // Click to choose which collection should this question be saved to
        cy.findByText(revokedUsersPersonalCollectionName).click();
        popover().within(() => {
          cy.findByText(/Our analytics/i);
          cy.findByText(/My personal collection/i);
          cy.findByText("Parent").should("not.exist");
          cy.log("Reported failing from v0.34.3");
          cy.findByText("Child");
        });
      });
    });

    it("sub-collection should be available in save and move modals (#14122)", () => {
      const COLLECTION = "14122C";
      // Create Parent collection within `Our analytics`
      cy.request("POST", "/api/collection", {
        name: COLLECTION,
        color: "#509EE3",
        parent_id: 1,
      });
      cy.visit("/collection/root");
      cy.findByRole("tree").as("sidebar");

      displaySidebarChildOf("Your personal collection");
      cy.findByText(COLLECTION);
      cy.get("@sidebar")
        .contains("Our analytics")
        .click();

      openEllipsisMenuFor("Orders");
      popover().within(() => {
        cy.findByText("Move").click();
      });

      modal().within(() => {
        cy.findByText("My personal collection")
          .parent()
          .find(".Icon-chevronright")
          .click();

        cy.findByText(COLLECTION).click();
        cy.findByText("Move")
          .closest(".Button")
          .should("not.be.disabled")
          .click();
      });
    });

    it("should show moved collections inside a folder tree structure (metabase#14280)", () => {
      const NEW_COLLECTION = "New collection";

      // Create New collection within `Our analytics`
      cy.request("POST", "/api/collection", {
        name: NEW_COLLECTION,
        color: "#509EE3",
        parent_id: null,
      });

      cy.visit("/collection/root");
      cy.findByText(NEW_COLLECTION);
      cy.findByText("First collection").click();
      cy.icon("pencil").click();
      cy.findByText("Edit this collection").click();
      modal().within(() => {
        // Open the select dropdown menu
        cy.findByText("Our analytics").click();
      });
      popover().within(() => {
        cy.findByText(NEW_COLLECTION).click();
      });
      // Make sure the correct value is selected
      cy.findAllByTestId("select-button-content").contains(NEW_COLLECTION);
      cy.button("Update").click();
      // Make sure modal closed
      cy.findByText("Update").should("not.exist");

      // Make sure sidebar updated (waiting for a specific XHR didn't help)
      closeNavigationSidebar();
      openNavigationSidebar();

      cy.log(
        "**New collection should immediately be open, showing nested children**",
      );

      getSidebarCollectionChildrenFor(NEW_COLLECTION).within(() => {
        cy.findByText("First collection");
        cy.findByText("Second collection");
      });
    });

    it("should update UI when nested child collection is moved to the root collection (metabase#14482)", () => {
      cy.visit("/collection/root");
      cy.log("Move 'Second collection' to the root");
      displaySidebarChildOf("First collection");
      cy.findByText("Second collection").click();
      cy.icon("pencil").click();
      cy.findByText("Edit this collection").click();
      modal().within(() => {
        // Open the select dropdown menu
        cy.findByText("First collection").click();
      });
      popover().within(() => {
        cy.findAllByText("Our analytics")
          .last()
          .click();
      });
      // Make sure the correct value is selected
      cy.findAllByTestId("select-button-content").contains("Our analytics");
      cy.findByText("Update")
        .closest(".Button")
        .should("not.be.disabled")
        .click();
      // Make sure modal closed
      cy.findByText("Update").should("not.exist");

      cy.findByRole("tree")
        .as("sidebar")
        .within(() => {
          cy.findAllByText("Second collection").should("have.length", 1);
          cy.findAllByText("Third collection").should("have.length", 1);
        });
    });

    it("should suggest questions saved in collections with colon in their name (metabase#14287)", () => {
      cy.request("POST", "/api/collection", {
        name: "foo:bar",
        color: "#509EE3",
        parent_id: null,
      }).then(({ body: { id: COLLECTION_ID } }) => {
        // Move question #1 ("Orders") to newly created collection
        cy.request("PUT", "/api/card/1", {
          collection_id: COLLECTION_ID,
        });
        // Sanity check: make sure Orders is indeed inside new collection
        cy.visit(`/collection/${COLLECTION_ID}`);
        cy.findByText("Orders");
      });

      cy.visit("/question/new");
      cy.findByText("Simple question").click();
      popover().within(() => {
        cy.findByText("Saved Questions").click();
        // Note: collection name's first letter is capitalized
        cy.findByText(/foo:bar/i).click();
        cy.findByText("Orders");
      });
    });

    it("collections without sub-collections shouldn't have chevron icon (metabase#14753)", () => {
      cy.visit("/collection/root");

      navigationSidebar()
        .findByText("Your personal collection")
        .parentsUntil("[data-testid=sidebar-collection-link-root]")
        .within(() => {
          cy.icon("chevronright").should("not.be.visible");
        });

      // Ensure if sub-collection is archived, the chevron is not displayed
      displaySidebarChildOf("First collection");
      navigationSidebar()
        .findByText("Second collection")
        .click();
      cy.icon("pencil").click();
      popover()
        .findByText("Archive this collection")
        .click();
      cy.get(".Modal")
        .findByRole("button", { name: "Archive" })
        .click();
      navigationSidebar()
        .findByText("First collection")
        .parent()
        .find(".Icon-chevrondown")
        .should("not.exist");
    });

    it("'Saved Questions' prompt should respect nested collections structure (metabase#14178)", () => {
      cy.request("GET", "/api/collection").then(({ body }) => {
        // Get "Second collection's" id dynamically instead of hard-coding it
        const SECOND_COLLECTION = body.filter(collection => {
          return collection.slug === "second_collection";
        });
        const [{ id }] = SECOND_COLLECTION;

        // Move first question in a DB snapshot ("Orders") inside "Second collection"
        cy.request("PUT", "/api/card/1", {
          collection_id: id,
        });
      });

      cy.visit("/");
      closeNavigationSidebar();
      cy.findByText("New").click();
      cy.findByText("Question")
        .should("be.visible")
        .click();

      popover().within(() => {
        cy.findByText("Saved Questions").click();
        cy.findByText("First collection");
        cy.findByText("Second collection").should("not.exist");
      });
    });

    describe("bulk actions", () => {
      describe("selection", () => {
        it("should be possible to apply bulk selection to all items (metabase#14705)", () => {
          bulkSelectDeselectWorkflow();
        });

        function bulkSelectDeselectWorkflow() {
          cy.visit("/collection/root");
          selectItemUsingCheckbox("Orders");
          cy.findByText("1 item selected").should("be.visible");

          cy.findByTestId("bulk-action-bar").within(() => {
            // Select all
            cy.findByRole("checkbox");
            cy.icon("dash").click({ force: true });
            cy.icon("dash").should("not.exist");
            cy.findByText("4 items selected");

            // Deselect all
            cy.icon("check").click({ force: true });
          });
          cy.icon("check").should("not.exist");
          cy.findByTestId("bulk-action-bar").should("not.be.visible");
        }
      });

      describe("archive", () => {
        it("should be possible to bulk archive items (metabase#16496)", () => {
          cy.visit("/collection/root");
          selectItemUsingCheckbox("Orders");

          cy.findByTestId("bulk-action-bar")
            .button("Archive")
            .click();

          cy.findByText("Orders").should("not.exist");
          cy.findByTestId("bulk-action-bar").should("not.be.visible");
        });
      });

      describe("move", () => {
        it("should be possible to bulk move items", () => {
          cy.visit("/collection/root");
          selectItemUsingCheckbox("Orders");

          cy.findByTestId("bulk-action-bar")
            .button("Move")
            .click();

          modal().within(() => {
            cy.findByText("First collection").click();
            cy.button("Move").click();
          });

          cy.findByText("Orders").should("not.exist");
          cy.findByTestId("bulk-action-bar").should("not.be.visible");

          // Check that items were actually moved
          navigationSidebar()
            .findByText("First collection")
            .click();
          cy.findByText("Orders");
        });
      });
    });

    it("collections list on the home page shouldn't depend on the name of the first 50 objects (metabase#16784)", () => {
      // Although there are already some objects in the default snapshot (3 questions, 1 dashboard, 3 collections),
      // let's create 50 more dashboards with the letter of alphabet `D` coming before the first letter of the existing collection `F`.
      _.times(50, i => cy.createDashboard({ name: `Dashboard ${i}` }));

      cy.visit("/");
      // There is already a collection named "First collection" in the default snapshot
      navigationSidebar().within(() => {
        cy.findByText("First collection");
      });
    });
  });
});

function openEllipsisMenuFor(item) {
  cy.findByText(item)
    .closest("tr")
    .find(".Icon-ellipsis")
    .click({ force: true });
}

function selectItemUsingCheckbox(item, icon = "table") {
  cy.findByText(item)
    .closest("tr")
    .within(() => {
      cy.icon(icon).trigger("mouseover");
      cy.findByRole("checkbox").click();
    });
}

function getSidebarCollectionChildrenFor(item) {
  return navigationSidebar()
    .findByText(item)
    .parentsUntil("[data-testid=sidebar-collection-link-root]")
    .parent()
    .next("ul");
}
