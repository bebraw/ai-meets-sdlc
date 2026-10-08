import {
  adminWorkspaceGroups,
  getAdminGroup,
  getAdminNavigationGroups,
} from "./admin-workspaces.ts";

function init() {
  return {
    adminWorkspaceGroups: () => adminWorkspaceGroups,
    adminNavigationGroups: getAdminNavigationGroups,
    adminGroupLabel: (current: string) => getAdminGroup(current)?.label,
    adminEyebrow: (current: string) =>
      `Admin / ${getAdminGroup(current)?.label ?? "Control room"}`,
    adminContextLabel: (current: string) =>
      `${getAdminGroup(current)?.label} workspaces`,
    adminContextItems: (current: string) =>
      getAdminNavigationGroups(current).find(
        (group) => group.id === getAdminGroup(current)?.id,
      )?.items ?? [],
    adminDeskCurrent: (current: string) => (current ? undefined : "page"),
  };
}

export { init };
