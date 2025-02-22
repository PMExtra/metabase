import styled from "@emotion/styled";
import { color } from "metabase/lib/colors";
import Icon from "metabase/components/Icon";
import ExternalLink from "metabase/core/components/ExternalLink";

export const CardRoot = styled(ExternalLink)`
  display: flex;
  align-items: center;
  padding: 1rem;
  border: 1px solid ${color("focus")};
  border-radius: 0.5rem;
`;

export const CardIcon = styled(Icon)`
  display: block;
  flex: 0 0 auto;
  color: ${color("text-dark")};
  width: 1rem;
  height: 1rem;
`;

export const CardTitle = styled.div`
  color: ${color("text-dark")};
  font-size: 1rem;
  font-weight: bold;
  margin-left: 1rem;
`;
