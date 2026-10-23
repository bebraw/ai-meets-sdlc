import {
  adminWorkspaceGroups,
  getAdminGroup,
  getAdminNavigationGroups,
} from "./admin-workspaces.ts";

function init() {
  return {
    socialImage: (value?: string) =>
      value || "https://sdlcai.org/og.png?v=20261018",
    socialImageAlt: (value?: string) =>
      value ||
      "SDLCAI: AI meets SDLC. Seminars on AI across the software development lifecycle. Explore the 2026 archive and hear about future events.",
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
