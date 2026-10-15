export type workspace_rect_t = {
  left: number
  top: number
  right: number
  bottom: number
}

export type workspace_profile_t = {
  timeline_wide: number
  short: number
  phone: number
  tablet: number
  wide: number
  large: number
  desktop: number
  choices: number
  extended: number
  landscape: number
}

export function workspace_profile(width: number, height: number, touch: number, fine = 0): workspace_profile_t {
  const side = Math.min(width, height)
  const wide = width >= 600 && height >= 600 ? 1 : 0
  const large = width >= 1000 && height >= 650 ? 1 : 0
  const phone = touch && side < 600 ? 1 : 0
  return {
    timeline_wide: wide || !phone && width >= 900 ? 1 : 0,
    short: height <= 360 ? 1 : 0,
    phone,
    tablet: touch && side >= 600 ? 1 : 0,
    wide,
    large,
    desktop: large && fine ? 1 : 0,
    choices: wide && fine ? 1 : 0,
    extended: large && fine ? 1 : 0,
    landscape: width > height && height <= 520 ? 1 : 0,
  }
}

export function workspace_media(): workspace_profile_t {
  return workspace_profile(innerWidth, innerHeight, matchMedia('(pointer:coarse)').matches ? 1 : 0, matchMedia('(hover:hover) and (pointer:fine)').matches ? 1 : 0)
}

export function workspace_layout_choice(profile: workspace_profile_t, saved: number): string {
  if (!profile.choices) return 'touch'
  if (saved < 0) {
    if (profile.desktop) return 'studio'
    return 'simple'
  }
  if (saved) return 'studio'
  return 'simple'
}

export function workspace_timeline_initial(profile: workspace_profile_t, layout: number, tablet: number): number {
  if (profile.tablet) {
    if (tablet < 0) return 1
    return tablet ? 1 : 0
  }
  if (layout >= 0) return layout ? 1 : 0
  return profile.desktop ? 1 : 0
}

export function workspace_writing_overlap(width: number, height: number, paper: workspace_rect_t, controls: workspace_rect_t[], layout = 'simple'): number {
  if (width <= 0 || height <= 0 || paper.right <= paper.left || paper.bottom <= paper.top) return 0
  if (width >= 1000 || layout === 'studio') return 0
  for (const rect of controls) {
    if (rect.right <= rect.left || rect.bottom <= rect.top) continue
    const overlap_width = Math.min(paper.right, rect.right) - Math.max(paper.left, rect.left)
    const overlap_height = Math.min(paper.bottom, rect.bottom) - Math.max(paper.top, rect.top)
    if (overlap_width <= 0 || overlap_height <= 0) continue
    return 1
  }
  return 0
}
