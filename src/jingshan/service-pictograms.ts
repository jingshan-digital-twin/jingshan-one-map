import type {SupportKind} from './venue-support.ts'

// Shared by the close-up map pins and compact service overview.
export const servicePictograms: Record<SupportKind|'venue'|'group',string> = {
  group:'m3 8 9-5 9 5-9 5zm0 5 9 5 9-5m-18 5 9 5 9-5',
  venue:'M2 5h20v14H2z M2 8h20 M2 16h20 M12 5v14 M7 8v8 M17 8v8 M7 12h10',
  hotels:'M3 5v15m18-6v6M3 16h18v-4a2 2 0 0 0-2-2h-7v5M6 8h3v4H6z',
  food:'M4 3v5a3 3 0 0 0 6 0V3M7 3v18m11-18q-5 4-4 10h4m0-10v18',
  charging:'m14 2-9 12h6l-1 8 9-13h-6z',
  medical:'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  parking:'M8 21V4h6a5 5 0 0 1 0 10H8',
  springs:'M3 16c1 7 17 7 18 0M7 14c-4-4 3-5 0-10m5 10c-4-4 3-5 0-11m5 11c-4-4 3-5 0-10',
  shopping:'M4 8h16l1 13H3zM8 9V7a4 4 0 0 1 8 0v2',
  tourism:'m2 20 8-14 5 8 3-5 5 11z',
  coaches:'M8 7a3 3 0 1 0 6 0 3 3 0 1 0-6 0m-4 14v-3a5 5 0 0 1 5-5h5l6-5',
  partners:'M4 5q3-4 7 0t-3 9q-6-1-4-9zm5 9-5 7m11-7q4-5 7 0t-5 5z',
}
