import type { SupportKind } from './venue-support'

// Same illustrated resource symbols used by the V1.4 inventory panel.
export const serviceIcons: Record<SupportKind,string> = {
  hotels:'lodging', food:'dining', parking:'parking', charging:'charging',
  medical:'medical', springs:'springs', coaches:'training', partners:'club', tourism:'travel', shopping:'private',
}
