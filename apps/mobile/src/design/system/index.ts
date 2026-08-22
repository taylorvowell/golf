/**
 * The Ideal Swing design system — the component layer every screen is assembled from.
 * Reference: `.claude/ideal-swing-design-system.html`; tokens in `src/theme/`.
 */
export { BRAND } from "./brand";
export { SCROLL_PRESS_DELAY_MS } from "./press";
export { displayLine, DISPLAY_LINE_RATIO, FONT_BODY, FONT_DISPLAY, TYPE } from "./typography";
export { DisplayText, TitleText, HeadingText, LabelText, Eyebrow, MetaText } from "./Text";
export { Button, type ButtonVariant } from "./Button";
export { RecordButton } from "./RecordButton";
export { Tag, type TagVariant } from "./Tag";
export { Delta } from "./Delta";
export { Chip } from "./Chip";
export { Input } from "./Input";
export { Segmented } from "./Segmented";
export { Panel, PanelHead } from "./Panel";
export { PortraitPicker, type PortraitOption } from "./PortraitPicker";
export { ListGroup, ListRow, ListSectionLabel } from "./ListRow";
export { AppHeader, APP_HEADER_BAR } from "./AppHeader";
export { DateTitle, dayTitleParts, formatDayTitle } from "./DateTitle";
export { PerformanceCard } from "./PerformanceCard";
export { ScoreOrb } from "./ScoreOrb";
export { ScoreRing } from "./ScoreRing";
export { TrendRing } from "./TrendRing";
export { ProgressTrack } from "./ProgressTrack";
export { SwingProfile, type ProfileCallout } from "./SwingProfile";
export { SwingTimelineList, type SwingTimelineItem } from "./SwingTimelineList";
export { CoachCard } from "./CoachCard";
export { StickThumb, STICK, type StickFigure } from "./StickThumb";
export { FORM_FIGURES, formFigureFor, type FormFigureName } from "./formArt";
export { CoachLoader } from "./CoachLoader";
export { GlowBackdrop } from "./GlowBackdrop";
export { WeekStrip, type WeekDay } from "./WeekStrip";
export { BrandLogo, BrandMark } from "./BrandLogo";
export { BrandIcon, BrandIconThumb } from "./BrandIcon";
export { BRAND_ICONS, type BrandIconName } from "./brandIconPaths";
export { WaveNav, WAVE_NAV_CLEARANCE, navBarBottomInset, type WaveNavItem } from "./WaveNav";
export { SessionPillNav, type SessionPillItem } from "./SessionPillNav";
export { NavVisibilityProvider, useNavVisibility, useChromeScroll } from "./navVisibility";
export { FloatingBack } from "./FloatingBack";
export { Skeleton } from "./Skeleton";
export { PendingDots } from "./PendingDots";
export { SheetOverBackdrop, HERO_PARALLAX, HERO_SHEET_GAP } from "./SheetOverBackdrop";
export { SideDrawer, type DrawerClose } from "./SideDrawer";
export { SheetHandle } from "./SheetHandle";
export { Sheet, type SheetProps } from "./Sheet";
export { PoseOutline } from "./PoseOutline";
export { DualViewIcon } from "./DualViewIcon";
export { CAPTURE_POSES } from "./capturePoses";
export {
  StanceStage,
  STANCE_DRAW_MS,
  STANCE_STAGGER_MS,
  type StanceAnnotation,
  type StanceTone,
} from "./StanceStage";
export { HeroBackdrop } from "./HeroBackdrop";
