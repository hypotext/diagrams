# Inspector

The inspector is a resizable pane in the "vanilla" Penrose renderer that provides _views_ on the `State` of a Penrose translation.

You can think of each inspector view as a variation on the original Canvas svg renderer; both have access to the same data but present it in different ways.

Each view in the inspector is indexed in `views/viewMap.tsx`. The key is the name that appears as a tab in the pane and the value is the component class of that view. Every view has access to the same data and events defined in `views/IViewProps.tsx`.

## Data

The inspector lets you see the `history` of each `frame` of state during optimization so that you can see the optimization dynamics play out over time.

The `../App.tsx` is the source of truth for the history. Every new state is appended to the history immutably.

The inspector has an internal state to track which `frame` has been "selected". This is so you can go back in time and see prior `frame`s in `history` if you want. This is tracked by index; but there is a second possible value for the current `frame`: `-1`. The value `-1` corresponds to "most recent `frame` in history", so you can see the _current_ frame all the time, dynamically updating. In the timeline, clicking a frame and clicking it again corresponds to whether you're tracking the most recent frame or clamping to the selected frame (blue outline in the thumbnail).

This interaction model is handy but annoying to deal with when you're implementing a new view. Thus the prop `frame` is provided which always gives the frame that should be inspected in the view, and `null` if none such exist (if the history is empty). You should handle both states with separate empty and populated views, as seen in existing views.

## Adding a view

Make a new component that accepts `IViewProps`, and then put it in `views/viewMap.tsx`.

A useful library component is `import { ObjectInspector } from "react-inspector";`, which gives a chrome-style JSON tree you can inspect.

See `ShapeView`, `Timeline`, and `Frames` for useful examples.

## Adding shape support to Mod view

Create a "mod file" for your shape and place it in `mod/shapedefs/`. This must be a standard format JSON file (uncommented) adhering to the following layout:

- The outermost layer must have exactly two entries: `shapeType` and `properties`.
- `shapeType` should correspond to the name for your shape in `../componentMap.tsx`.
- `properties` should be a nested object. Each 'entry' within `properties` must correspond to a property in `YOURSHAPE.tsx` (e.g. `Circle.tsx`).
- Each property within `properties` should have the following subentries:
  - An input type property `inputType` corresponding to the appropriate HTML input element you would like to use to customize that property. Currently supported types are `range`, `select`, `text`, `url`, `number`, `color`, `checkbox`, `mulptrange`, `ptrange`. This entry is **required**.
  - A property `showValue`, set to either `"true"` or `"false"`. If set to `"true"`, the current value of the input element will be displayed next to the input element. For example, on a `range` input element, the user will not see the actual value of the slider in numeric form unless `showValue` is set to true. It is recommended that for `range` specifically, `showValue` is always set to `"true"` and all other input types `showValue` is `"false"`. If left out, this will default to `"false"`.
  - If the input type is `select`, there must be a subentry entitled `options`, which is an array of all possible options for the dropdown menu. This is **required**.
  - Any other [HTML input customization features](https://www.w3schools.com/html/html_form_input_types.asp). For example, the `range` input type takes in a `min` and `max` value respectively. You may provide your own values for these. If you do not choose to, such fields will take their HTML-defined default value. For instance, the `min` and `max` fields for `range` have default values of `0` and `100` respectively.
- You only need to list the properties which you intend to be customizable. For instance, if you want the `strokeStyle` property to be immutable, do not include it in the mod file.
- For properties that correspond to screen coordinates, such as `x` and `y` in most shapes, you can choose to express minimum and maximum values for `range` and `number` inputs in terms of the canvas. For instance, if you would like the range of possible x-coordinates to be the canvas width, set the `min` and `max` value of your `x` property to `CANVASL` AND `CANVASR`, respectively (canvas left and right). `CANVAST` and `CANVASB` refer to the top and bottom of the canvas. See `mod/shapedefs/Circle.json` for examples of this. However, this shortcut is currently not recommended. The SVG canvas currently is hardcoded to have dimensions 800 x 700, no matter your browser dimensions, and the canvas shortcuts implement those fixed dimensions. Until the canvas size is dependent on browser size, we recommend you hardcode `min` and `max`.

See the existing JSON files in `mod/shapedefs/` for examples.

After creating the mod file, add it to `mod/defmap.tsx`.

## Unimplemented behavior

- [ ] Make scrolling not terrible (the bottom is currently cut off unless your inspector is tall enough, due to padding and box model and overflow: hidden).
- [ ] Sync current selected frame and the frame being shown on the canvas
- [ ] Provide an absolute-positioned overlay interface on top of canvas that highlights shape being inspected (needs to pass along pointer-events so interactions are still possible beneath). Google chrome inspector style

## Limitations

### Mod

- The `pathData` attribute is only modifiable if it contains a list of `IPt`. Currently does not work with Bezier curves.
- If the types in `types.d.ts` change form, `LabeledInput.tsx` will likely need to be modified. For example, if the structure of `IPathData` is changed, attempting to modify the `pathData` attribute will result in a crash.
- Uses the fact that the canvas is hardcoded. Needs to be updated when that changes.
