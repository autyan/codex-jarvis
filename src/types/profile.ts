export type TaskProfile = {
  id: string;
  name: string;
  mode: "Diagnose" | "Patch" | "Suggest";
  description: string;
  paths: string[];
};

