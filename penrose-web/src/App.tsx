import { stepState, resample } from "API";
import Inspector from "inspector/Inspector";
import * as React from "react";
import SplitPane from "react-split-pane";
import ButtonBar from "ui/ButtonBar";
import Canvas from "ui/Canvas";
import Log from "utils/Log";
import { converged, initial } from "./packets";
import { ConnectionStatus, Protocol } from "./Protocol";

interface ICanvasState {
  data: State | undefined; // NOTE: if the backend is not connected, data will be undefined, TODO: rename this field
  autostep: boolean;
  processedInitial: boolean;
  penroseVersion: string;
  history: State[];
  showInspector: boolean;
}

const socketAddress = "ws://localhost:9160";
class App extends React.Component<any, ICanvasState> {
  public readonly state: ICanvasState = {
    data: undefined,
    history: [],
    autostep: false,
    processedInitial: false, // TODO: clarify the semantics of this flag
    penroseVersion: "",
    showInspector: true,
  };
  public readonly canvas = React.createRef<Canvas>();
  public readonly buttons = React.createRef<ButtonBar>();

  public modShapes = async (state: State) => {
    this.modCanvas(state); // is this the right way to call it
  };

  public onConnectionStatus = (conn: ConnectionStatus) => {
    Log.info(`Connection status: ${conn}`);
  };
  public onVersion = (version: string) => {
    this.setState({ penroseVersion: version });
  };
  // same as onCanvasState but doesn't alter timeline or involve optimization
  // used only in modshapes
  public modCanvas = async (canvasState: State) => {
    await new Promise((r) => setTimeout(r, 1));

    await this.setState({
      data: canvasState,
      processedInitial: true,
    });
  };
  public onCanvasState = async (canvasState: State) => {
    // HACK: this will enable the "animation" that we normally expect
    await new Promise((r) => setTimeout(r, 1));

    await this.setState({
      data: canvasState,
      history: [...this.state.history, canvasState],
      processedInitial: true,
    });
    const { autostep } = this.state;
    if (autostep && !converged(canvasState)) {
      await this.step();
    }
  };
  public downloadSVG = () => {
    if (this.canvas.current !== null) {
      this.canvas.current.downloadSVG();
    }
  };
  public downloadPDF = () => {
    if (this.canvas.current !== null) {
      this.canvas.current.downloadPDF();
    }
  };
  public autoStepToggle = async () => {
    await this.setState({ autostep: !this.state.autostep });
    if (this.state.autostep && this.state.processedInitial) {
      this.step();
    }
  };
  public protocol: Protocol = new Protocol(socketAddress, [
    {
      onConnectionStatus: this.onConnectionStatus,
      onVersion: this.onVersion,
      onCanvasState: this.onCanvasState,
      onError: console.warn,
      kind: "renderer",
    },
  ]);
  public step = async () => {
    const stepped = await stepState(this.state.data!);
    this.onCanvasState(stepped);
  };

  public resample = async () => {
    const NUM_SAMPLES = 1;
    const oldState = this.state.data;
    if (oldState) {
      await this.setState({ processedInitial: false });
      const resampled = await resample(oldState, NUM_SAMPLES);
      this.onCanvasState(resampled);
    }
  };

  public async componentDidMount() {
    this.protocol = new Protocol(socketAddress, [
      {
        onConnectionStatus: this.onConnectionStatus,
        onVersion: this.onVersion,
        onCanvasState: this.onCanvasState,
        onError: console.warn,
        kind: "renderer",
      },
    ]);

    this.protocol.setupSockets();
  }

  public updateData = async (data: any) => {
    await this.setState({ data: { ...data } });
    if (this.state.autostep) {
      const stepped = await stepState(data);
      this.onCanvasState(stepped);
    }
  };
  public setInspector = async (showInspector: boolean) => {
    await this.setState({ showInspector });
    // localStorage.setItem("showInspector", showInspector ? "true" : "false");
  };
  public toggleInspector = async () => {
    await this.setInspector(!this.state.showInspector);
  };
  public hideInspector = async () => {
    await this.setInspector(false);
  };

  public render() {
    const {
      data,
      autostep,
      penroseVersion,
      showInspector,
      history,
    } = this.state;
    return (
      <div
        className="App"
        style={{
          height: "100%",
          display: "flex",
          flexFlow: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ flexShrink: 0 }}>
          <ButtonBar
            downloadPDF={this.downloadPDF}
            downloadSVG={this.downloadSVG}
            // stepUntilConvergence={stepUntilConvergence}
            autostep={autostep}
            step={this.step}
            autoStepToggle={this.autoStepToggle}
            resample={this.resample}
            converged={data ? converged(data) : false}
            initial={data ? initial(data) : false}
            toggleInspector={this.toggleInspector}
            showInspector={showInspector}
            ref={this.buttons}
          />
        </div>
        <div style={{ flexGrow: 1, position: "relative", overflow: "hidden" }}>
          <SplitPane
            split="horizontal"
            defaultSize={400}
            style={{ position: "inherit" }}
            className={this.state.showInspector ? "" : "soloPane1"}
            pane2Style={{ overflow: "hidden" }}
          >
            <Canvas
              data={data}
              updateData={this.updateData}
              lock={false}
              ref={this.canvas}
              penroseVersion={penroseVersion}
            />
            {showInspector && (
              <Inspector
                history={history}
                onClose={this.toggleInspector}
                modShapes={this.modShapes}
              />
            )}
          </SplitPane>
        </div>
      </div>
    );
  }
}

export default App;
