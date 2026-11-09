import { Component, type ReactNode } from "react";

// Read retiring nodes before React removes them. A layout effect runs after
// that removal, when the visible CSS transition position is no longer readable.
export class RailMotionSnapshot extends Component<{
  beforeUpdate: () => void;
  children: ReactNode;
}> {
  getSnapshotBeforeUpdate() {
    this.props.beforeUpdate();
    return null;
  }
  componentDidUpdate() {}
  render() {
    return this.props.children;
  }
}
