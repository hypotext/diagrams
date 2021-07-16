import * as React from "react";
import IViewProps from "./IViewProps";
import { prettyPrintFn, evalFns } from "@penrose/core";
import { zip } from "lodash";
import DataTable from "react-data-table-component";
const Opt: React.FC<IViewProps> = ({ frame, history }: IViewProps) => {
  if (!frame) {
    return (
      <div style={{ padding: "1em", fontSize: "1em", color: "#4f4f4f" }}>
        no frame
      </div>
    );
  }
  const constrInfos = zip(
    frame.constrFns.map(prettyPrintFn),
    evalFns(frame.constrFns, frame)
  ).map(([name, energy]) => ({
    name,
    energy,
    type: "constraint",
    sat: energy! <= 0 ? "yes" : "no",
  }));
  const objInfos = zip(
    frame.objFns.map(prettyPrintFn),
    evalFns(frame.objFns, frame)
  ).map(([name, energy]) => ({
    name,
    energy,
    type: "objective",
    sat: energy! <= 0 ? "yes" : "no",
  }));

  // TODO: hyperlink the shapes
  return (
    <div style={{ boxSizing: "border-box" }}>
      <DataTable
        data={[...constrInfos, ...objInfos]}
        title={"Optimization"}
        dense={true}
        highlightOnHover={true}
        striped={true}
        columns={[
          { name: "Expression", selector: "name", sortable: true },
          { name: "Energy", selector: "energy", sortable: true },
          { name: "Type", selector: "type", sortable: true },
          { name: "Satisfied?", selector: "sat", sortable: true },
        ]}
        conditionalRowStyles={[
          {
            when: (row) => row.sat === "no",
            style: {
              backgroundColor: `#ffcabe !important`,
            },
          },
        ]}
      />
    </div>
  );
};
export default Opt;
