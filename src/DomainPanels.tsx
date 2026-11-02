import type { ComponentProps } from "react";
import { deferredPanel } from "./DeferredPanel";
export const RiskActionsPanel = deferredPanel<
  ComponentProps<(typeof import("./RiskActionsPanel"))["RiskActionsPanel"]>
>(() =>
  import("./RiskActionsPanel").then((m) => ({ default: m.RiskActionsPanel })),
);
export const RiskCorePanel = deferredPanel<
  ComponentProps<(typeof import("./RiskCorePanel"))["RiskCorePanel"]>
>(() => import("./RiskCorePanel").then((m) => ({ default: m.RiskCorePanel })));
export const CompanyPpePanel = deferredPanel<
  ComponentProps<(typeof import("./CompanyPpePanel"))["CompanyPpePanel"]>
>(() =>
  import("./CompanyPpePanel").then((m) => ({ default: m.CompanyPpePanel })),
);
export const WorkStopPanel = deferredPanel<
  ComponentProps<(typeof import("./WorkStopPanel"))["WorkStopPanel"]>
>(() => import("./WorkStopPanel").then((m) => ({ default: m.WorkStopPanel })));
export const IncidentsPanel = deferredPanel<
  ComponentProps<(typeof import("./IncidentsPanel"))["IncidentsPanel"]>
>(() => import("./IncidentsPanel").then((m) => ({ default: m.IncidentsPanel })));
export const QualificationsPanel = deferredPanel<
  ComponentProps<(typeof import("./QualificationsPanel"))["QualificationsPanel"]>
>(() => import("./QualificationsPanel").then((m) => ({ default: m.QualificationsPanel })));
export const PermitsPanel = deferredPanel<
  ComponentProps<(typeof import("./PermitsPanel"))["PermitsPanel"]>
>(() => import("./PermitsPanel").then((m) => ({ default: m.PermitsPanel })));
export const ManagerOverview = deferredPanel<
  ComponentProps<(typeof import("./ManagerOverview"))["ManagerOverview"]>
>(() =>
  import("./ManagerOverview").then((m) => ({ default: m.ManagerOverview })),
);
export const WorkPlanPanel = deferredPanel<
  ComponentProps<(typeof import("./WorkPlanPanel"))["WorkPlanPanel"]>
>(() => import("./WorkPlanPanel").then((m) => ({ default: m.WorkPlanPanel })));
export const StockPanel = deferredPanel<
  ComponentProps<(typeof import("./StockPanel"))["StockPanel"]>
>(() => import("./StockPanel").then((m) => ({ default: m.StockPanel })));
export const CostPanel = deferredPanel<
  ComponentProps<(typeof import("./CostPanel"))["CostPanel"]>
>(() => import("./CostPanel").then((m) => ({ default: m.CostPanel })));
export const DailyJournalPanel = deferredPanel<
  ComponentProps<(typeof import("./DailyJournalPanel"))["DailyJournalPanel"]>
>(() =>
  import("./DailyJournalPanel").then((m) => ({ default: m.DailyJournalPanel })),
);
export const EquipmentPanel = deferredPanel<
  ComponentProps<(typeof import("./EquipmentPanel"))["EquipmentPanel"]>
>(() =>
  import("./EquipmentPanel").then((m) => ({ default: m.EquipmentPanel })),
);
export const NoticesPanel = deferredPanel<
  ComponentProps<(typeof import("./NoticesPanel"))["NoticesPanel"]>
>(() => import("./NoticesPanel").then((m) => ({ default: m.NoticesPanel })));
export const EducationPanel = deferredPanel<
  ComponentProps<(typeof import("./EducationPanel"))["EducationPanel"]>
>(() =>
  import("./EducationPanel").then((m) => ({ default: m.EducationPanel })),
);
export const InspectionsPanel = deferredPanel<
  ComponentProps<(typeof import("./InspectionsPanel"))["InspectionsPanel"]>
>(() =>
  import("./InspectionsPanel").then((m) => ({ default: m.InspectionsPanel })),
);
export const HazardsPanel = deferredPanel<
  ComponentProps<(typeof import("./HazardsPanel"))["HazardsPanel"]>
>(() => import("./HazardsPanel").then((m) => ({ default: m.HazardsPanel })));
export const TbmPanel = deferredPanel<
  ComponentProps<(typeof import("./TbmPanel"))["TbmPanel"]>
>(() => import("./TbmPanel").then((m) => ({ default: m.TbmPanel })));
export const WorkersAttendance = deferredPanel<
  ComponentProps<(typeof import("./WorkersAttendance"))["WorkersAttendance"]>
>(() =>
  import("./WorkersAttendance").then((m) => ({ default: m.WorkersAttendance })),
);
export const PhotoBoardPanel = deferredPanel<
  ComponentProps<(typeof import("./PhotoBoardPanel"))["PhotoBoardPanel"]>
>(() => import("./PhotoBoardPanel").then((m) => ({ default: m.PhotoBoardPanel })));
export const LibraryPanel = deferredPanel<
  ComponentProps<(typeof import("./LibraryPanel"))["LibraryPanel"]>
>(() => import("./LibraryPanel").then((m) => ({ default: m.LibraryPanel })));
