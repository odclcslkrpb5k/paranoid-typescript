// Fails only under noImplicitOverride: the override is not marked.
class Base {
  m(): void {}
}
export class Derived extends Base {
  m(): void {}
}
