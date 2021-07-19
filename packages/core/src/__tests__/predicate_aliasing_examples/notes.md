### Predicate Aliasing Examples

Run `yarn start` in the root folder.
Navigate to `packages/core/src/__tests__/predicate_aliasing_examples`
Run `npx roger watch` on one of the following trios:

- `tree.sub tree.sty setTheory.dsl` (has GPIs nested under aliases)
- `tree.sub venn.sty setTheory.dsl` (has constraints/objectives and GPIs nested under aliases)
- `tree.sub venn-3d.sty setTheory.dsl` (has aliasing in style, but no constraints/objectives or GPIs nested under aliases)
  Open localhost, and toggle the objects in `translation/trMap`
