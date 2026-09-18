declare module '*.inkdown' {
  import type { Fragment, Metadata } from '@gneh/core';
  export const fragments: Readonly<Record<string, Fragment>>;
  export const metadata: Readonly<Record<string, Metadata>>;
  const primary: Fragment;
  export default primary;
}

declare module '*.karlowe' {
  import type { Fragment, Metadata } from '@gneh/core';
  export const fragments: Readonly<Record<string, Fragment>>;
  export const metadata: Readonly<Record<string, Metadata>>;
  const primary: Fragment;
  export default primary;
}

declare module '*.sugarcast' {
  import type { Fragment, Metadata } from '@gneh/core';
  export const fragments: Readonly<Record<string, Fragment>>;
  export const metadata: Readonly<Record<string, Metadata>>;
  const primary: Fragment;
  export default primary;
}
