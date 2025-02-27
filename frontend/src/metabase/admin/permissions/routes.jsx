import React from "react";
import { Route } from "metabase/hoc/Title";
import { IndexRedirect } from "react-router";
import { t } from "ttag";

import CollectionPermissionsPage from "./pages/CollectionPermissionsPage/CollectionPermissionsPage";
import DatabasesPermissionsPage from "./pages/DatabasePermissionsPage/DatabasesPermissionsPage";
import GroupsPermissionsPage from "./pages/GroupDataPermissionsPage/GroupsPermissionsPage";
import DataPermissionsPage from "./pages/DataPermissionsPage/DataPermissionsPage";
import {
  PLUGIN_ADMIN_PERMISSIONS_TABLE_ROUTES,
  PLUGIN_ADMIN_PERMISSIONS_TABLE_GROUP_ROUTES,
  PLUGIN_GENERAL_PERMISSIONS,
} from "metabase/plugins";

const getRoutes = () => (
  <Route title={t`Permissions`}>
    <IndexRedirect to="data" />

    <Route path="data" component={DataPermissionsPage}>
      <IndexRedirect to="group" />

      <Route
        path="database(/:databaseId)(/schema/:schemaName)(/table/:tableId)"
        component={DatabasesPermissionsPage}
      >
        {PLUGIN_ADMIN_PERMISSIONS_TABLE_GROUP_ROUTES}
      </Route>

      <Route
        path="group(/:groupId)(/database/:databaseId)(/schema/:schemaName)"
        component={GroupsPermissionsPage}
      >
        {PLUGIN_ADMIN_PERMISSIONS_TABLE_ROUTES}
      </Route>
    </Route>

    <Route path="collections" component={CollectionPermissionsPage}>
      <Route path=":collectionId" />
    </Route>

    {PLUGIN_GENERAL_PERMISSIONS.getRoutes()}
  </Route>
);

export default getRoutes;
