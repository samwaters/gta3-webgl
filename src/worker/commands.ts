export const CommandsEnum = {
  CHECK: "CHECK",
  DELETE: "DELETE",
  EXTRACT: "EXTRACT",
  FETCH: "FETCH",
  GETFILES: "GETFILES",
  SET_ID: "SET_ID",
}
export type Commands = (typeof CommandsEnum)[keyof typeof CommandsEnum]
