// Fails only with allowUnusedLabels false: a label nothing breaks to.
export function f(): void {
  unused: for (;;) {
    break;
  }
}
