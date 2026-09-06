import { SiteHeader } from './SiteHeader.jsx';

// React owns every descendant of #site-header on the demo page. The player keeps using
// lib/header.js until its own migration slice, so there is never a competing DOM owner.
export function DemoHeader() {
  return <SiteHeader page="demos" />;
}
