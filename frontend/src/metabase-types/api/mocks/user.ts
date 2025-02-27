import { User } from "metabase-types/api";

export const createMockUser = (opts?: Partial<User>): User => ({
  id: 1,
  first_name: "Testy",
  last_name: "Tableton",
  common_name: `Testy Tableton`,
  email: "user@metabase.test",
  google_auth: false,
  is_active: true,
  is_qbnewb: false,
  is_superuser: false,
  is_installer: false,
  has_invited_second_user: false,
  has_question_and_dashboard: false,
  personal_collection_id: 1,
  date_joined: new Date().toISOString(),
  last_login: new Date().toISOString(),
  can_access_data_model: false,
  can_access_database_management: false,
  ...opts,
});
