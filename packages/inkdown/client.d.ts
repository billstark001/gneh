declare module '*.inkdown' {
  import type { PassageSet } from '@gneh/runtime';
  const passages: PassageSet;
  export default passages;
}
