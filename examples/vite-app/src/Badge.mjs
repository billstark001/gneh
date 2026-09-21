import { defineView, v } from '@gneh/runtime';

export const badgeDescription = 'Rendered by a handwritten defineView() callable.';

/** @typedef {{ label: string; detail?: string }} BadgeProps */
export default defineView(
  /** @param {BadgeProps} props */
  (props) => v.p(v.strong(props.label), ' — ', props.detail ?? badgeDescription),
);
