/**
 * Icon registry — maps semantic names to Phosphor icon components.
 *
 * Call sites use <Icon name="..." /> and never import Phosphor directly, so an
 * individual glyph can later be swapped for a custom doodle SVG (see ./custom)
 * by adding one line to `customRegistry` — with zero changes at any call site.
 *
 * Phosphor exposes `Foo` (deprecated) and `FooIcon` named exports; we use the
 * `*Icon` form. ~3000 glyphs in 6 weights; we render `duotone` by default for
 * the two-tone "sticker" bakery look.
 */
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BankIcon,
  BasketIcon,
  BirdIcon,
  BrainIcon,
  BroadcastIcon,
  BuildingsIcon,
  CalculatorIcon,
  CaretDownIcon,
  CaretRightIcon,
  CardsIcon,
  ChartDonutIcon,
  ChartLineUpIcon,
  ChartPieSliceIcon,
  CheckIcon,
  CheckCircleIcon,
  ChefHatIcon,
  CoffeeIcon,
  CpuIcon,
  CubeIcon,
  CurrencyBtcIcon,
  FactoryIcon,
  FirstAidKitIcon,
  FunctionIcon,
  GasPumpIcon,
  GearIcon,
  GlobeIcon,
  GlobeHemisphereEastIcon,
  GlobeHemisphereWestIcon,
  type Icon as PhosphorIcon,
  HouseLineIcon,
  KeyIcon,
  LightningIcon,
  LinkIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  MoneyIcon,
  MountainsIcon,
  PackageIcon,
  PawPrintIcon,
  PlantIcon,
  PlayIcon,
  PlusIcon,
  RocketIcon,
  RulerIcon,
  ScalesIcon,
  ScrollIcon,
  ShieldIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  SparkleIcon,
  SunHorizonIcon,
  TargetIcon,
  TrendDownIcon,
  TrendUpIcon,
  WalletIcon,
  WarningIcon,
  WavesIcon,
  XIcon,
} from 'phosphor-react-native';

export const iconRegistry = {
  // ── Navigation (tabs) ──────────────────────────────────────────────
  globe: GlobeHemisphereWestIcon,
  markets: ChartPieSliceIcon,
  portfolio: WalletIcon,
  agents: ChefHatIcon,
  settings: GearIcon,

  // ── Agents ─────────────────────────────────────────────────────────
  research: MagnifyingGlassIcon,
  council: ScalesIcon,
  criteria: ListChecksIcon,
  evaluation: ChartLineUpIcon,

  // ── Regions (differentiated by color; globe variant by hemisphere) ──
  'region-na': GlobeHemisphereWestIcon,
  'region-eu': GlobeIcon,
  'region-apac': GlobeHemisphereEastIcon,
  'region-china': GlobeHemisphereEastIcon,
  'region-latam': GlobeHemisphereWestIcon,
  'region-mea': GlobeIcon,

  // ── Sectors ────────────────────────────────────────────────────────
  'sector-tech': CpuIcon,
  'sector-financials': BankIcon,
  'sector-health': FirstAidKitIcon,
  'sector-discretionary': ShoppingBagIcon,
  'sector-staples': BasketIcon,
  'sector-comms': BroadcastIcon,
  'sector-industrials': FactoryIcon,
  'sector-energy': GasPumpIcon,
  'sector-materials': MountainsIcon,
  'sector-utilities': LightningIcon,
  'sector-realestate': BuildingsIcon,

  // ── Asset types ────────────────────────────────────────────────────
  'asset-equities': TrendUpIcon,
  'asset-etf': BasketIcon,
  'asset-commodities': CubeIcon,
  'asset-crypto': CurrencyBtcIcon,
  'asset-bonds': ScrollIcon,
  'asset-realestate': BuildingsIcon,
  'asset-cash': MoneyIcon,
  'asset-funds': ChartDonutIcon,
  'asset-derivatives': FunctionIcon,

  // ── Account types ──────────────────────────────────────────────────
  'account-sipp': SunHorizonIcon,
  'account-isa': ShieldIcon,
  'account-lisa': KeyIcon,
  'account-gia': ChartLineUpIcon,
  'account-cash': MoneyIcon,
  'account-property': HouseLineIcon,
  'account-mortgage': BankIcon,
  'account-other': PackageIcon,

  // ── Goals ──────────────────────────────────────────────────────────
  'goal-default': TargetIcon,
  'goal-retirement': SunHorizonIcon,
  'goal-house': HouseLineIcon,

  // ── Council persona accents ────────────────────────────────────────
  'persona-buffett': CoffeeIcon,
  'persona-graham': RulerIcon,
  'persona-wood': RocketIcon,
  'persona-munger': BrainIcon,
  'persona-ackman': TargetIcon,
  'persona-burry': MagnifyingGlassIcon,
  'persona-pabrai': CardsIcon,
  'persona-taleb': BirdIcon,
  'persona-lynch': ShoppingCartIcon,
  'persona-fisher': PlantIcon,
  'persona-jhunjhunwala': PawPrintIcon,
  'persona-druckenmiller': WavesIcon,
  'persona-damodaran': CalculatorIcon,

  // ── Generic UI ─────────────────────────────────────────────────────
  'chevron-right': CaretRightIcon,
  'chevron-down': CaretDownIcon,
  'arrow-right': ArrowRightIcon,
  'arrow-left': ArrowLeftIcon,
  plus: PlusIcon,
  check: CheckIcon,
  'check-circle': CheckCircleIcon,
  close: XIcon,
  link: LinkIcon,
  play: PlayIcon,
  sparkle: SparkleIcon,
  warning: WarningIcon,
  'trend-up': TrendUpIcon,
  'trend-down': TrendDownIcon,
} satisfies Record<string, PhosphorIcon>;

export type IconName = keyof typeof iconRegistry;
