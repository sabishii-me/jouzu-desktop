import { Image, token } from "nsh";
import { cn } from "../lib";

import icon_triangle_alert from "../assets/icons/triangle-alert.svg";
import icon_archive from "../assets/icons/archive.svg";
import icon_archive_restore from "../assets/icons/archive-restore.svg";
import icon_arrow_down from "../assets/icons/arrow-down.svg";
import icon_arrow_up from "../assets/icons/arrow-up.svg";
import icon_arrow_up_circle from "../assets/icons/arrow-up-circle.svg";
import icon_arrow_up_down from "../assets/icons/arrow-up-down.svg";
import icon_arrow_up_right from "../assets/icons/arrow-up-right.svg";
import icon_bot from "../assets/icons/bot.svg";
import icon_brain from "../assets/icons/brain.svg";
import icon_bug from "../assets/icons/bug.svg";
import icon_check from "../assets/icons/check.svg";
import icon_circle_check_big from "../assets/icons/circle-check-big.svg";
import icon_chevron_down from "../assets/icons/chevron-down.svg";
import icon_chevron_right from "../assets/icons/chevron-right.svg";
import icon_chevron_up from "../assets/icons/chevron-up.svg";
import icon_chevrons_up_down from "../assets/icons/chevrons-up-down.svg";
import icon_circle from "../assets/icons/circle.svg";
import icon_circle_gauge from "../assets/icons/circle-gauge.svg";
import icon_circle_slash from "../assets/icons/circle-slash.svg";
import icon_columns_2 from "../assets/icons/columns-2.svg";
import icon_compass from "../assets/icons/compass.svg";
import icon_copy from "../assets/icons/copy.svg";
import icon_cpu from "../assets/icons/cpu.svg";
import icon_database from "../assets/icons/database.svg";
import icon_download from "../assets/icons/download.svg";
import icon_external_link from "../assets/icons/external-link.svg";
import icon_eye from "../assets/icons/eye.svg";
import icon_file from "../assets/icons/file.svg";
import icon_file_text from "../assets/icons/file-text.svg";
import icon_folder from "../assets/icons/folder.svg";
import icon_folder_open from "../assets/icons/folder-open.svg";
import icon_folder_plus from "../assets/icons/folder-plus.svg";
import icon_gauge from "../assets/icons/gauge.svg";
import icon_git_fork from "../assets/icons/git-fork.svg";
import icon_image_off from "../assets/icons/image-off.svg";
import icon_image_plus from "../assets/icons/image-plus.svg";
import icon_images from "../assets/icons/images.svg";
import icon_key_round from "../assets/icons/key-round.svg";
import icon_languages from "../assets/icons/languages.svg";
import icon_list_todo from "../assets/icons/list-todo.svg";
import icon_loader_circle from "../assets/icons/loader-circle.svg";
import icon_maximize_2 from "../assets/icons/maximize-2.svg";
import icon_message_square from "../assets/icons/message-square.svg";
import icon_minimize_2 from "../assets/icons/minimize-2.svg";
import icon_minus from "../assets/icons/minus.svg";
import icon_ellipsis from "../assets/icons/ellipsis.svg";
import icon_palette from "../assets/icons/palette.svg";
import icon_panel_left from "../assets/icons/panel-left.svg";
import icon_panel_right from "../assets/icons/panel-right.svg";
import icon_pencil from "../assets/icons/pencil.svg";
import icon_pencil_line from "../assets/icons/pencil-line.svg";
import icon_pin from "../assets/icons/pin.svg";
import icon_plug from "../assets/icons/plug.svg";
import icon_plus from "../assets/icons/plus.svg";
import icon_quote from "../assets/icons/quote.svg";
import icon_refresh_cw from "../assets/icons/refresh-cw.svg";
import icon_rotate_ccw from "../assets/icons/rotate-ccw.svg";
import icon_search from "../assets/icons/search.svg";
import icon_send from "../assets/icons/send.svg";
import icon_settings from "../assets/icons/settings.svg";
import icon_shield_alert from "../assets/icons/shield-alert.svg";
import icon_sliders_horizontal from "../assets/icons/sliders-horizontal.svg";
import icon_sparkles from "../assets/icons/sparkles.svg";
import icon_square from "../assets/icons/square.svg";
import icon_square_terminal from "../assets/icons/square-terminal.svg";
import icon_terminal from "../assets/icons/terminal.svg";
import icon_trash_2 from "../assets/icons/trash-2.svg";
import icon_video from "../assets/icons/video.svg";
import icon_wrench from "../assets/icons/wrench.svg";
import icon_x from "../assets/icons/x.svg";

const ICONS = {
  AlertTriangle: icon_triangle_alert,
  Archive: icon_archive,
  ArchiveRestore: icon_archive_restore,
  ArrowDown: icon_arrow_down,
  ArrowUp: icon_arrow_up,
  ArrowUpCircle: icon_arrow_up_circle,
  ArrowUpDown: icon_arrow_up_down,
  ArrowUpRight: icon_arrow_up_right,
  Bot: icon_bot,
  Brain: icon_brain,
  Bug: icon_bug,
  Check: icon_check,
  CheckCircle2: icon_circle_check_big,
  CheckIcon: icon_check,
  ChevronDown: icon_chevron_down,
  ChevronDownIcon: icon_chevron_down,
  ChevronRight: icon_chevron_right,
  ChevronUp: icon_chevron_up,
  ChevronUpIcon: icon_chevron_up,
  ChevronsUpDown: icon_chevrons_up_down,
  Circle: icon_circle,
  CircleGauge: icon_circle_gauge,
  CircleSlash: icon_circle_slash,
  Columns2: icon_columns_2,
  Compass: icon_compass,
  Copy: icon_copy,
  Cpu: icon_cpu,
  Database: icon_database,
  Download: icon_download,
  ExternalLink: icon_external_link,
  Eye: icon_eye,
  File: icon_file,
  FileText: icon_file_text,
  Folder: icon_folder,
  FolderOpen: icon_folder_open,
  FolderPlus: icon_folder_plus,
  Gauge: icon_gauge,
  GitFork: icon_git_fork,
  ImageOff: icon_image_off,
  ImagePlus: icon_image_plus,
  Images: icon_images,
  KeyRound: icon_key_round,
  Languages: icon_languages,
  ListTodo: icon_list_todo,
  LoaderCircle: icon_loader_circle,
  Maximize2: icon_maximize_2,
  MessageSquare: icon_message_square,
  Minimize2: icon_minimize_2,
  Minus: icon_minus,
  MoreHorizontal: icon_ellipsis,
  Palette: icon_palette,
  PanelLeft: icon_panel_left,
  PanelRight: icon_panel_right,
  Pencil: icon_pencil,
  PencilLine: icon_pencil_line,
  Pin: icon_pin,
  Plug: icon_plug,
  Plus: icon_plus,
  Quote: icon_quote,
  RefreshCw: icon_refresh_cw,
  RotateCcw: icon_rotate_ccw,
  Search: icon_search,
  Send: icon_send,
  Settings: icon_settings,
  ShieldAlert: icon_shield_alert,
  SlidersHorizontal: icon_sliders_horizontal,
  Sparkles: icon_sparkles,
  Square: icon_square,
  SquareTerminal: icon_square_terminal,
  Terminal: icon_terminal,
  Trash2: icon_trash_2,
  Video: icon_video,
  Wrench: icon_wrench,
  X: icon_x,
  XIcon: icon_x,
} as const;

export type IconName = keyof typeof ICONS;

/** A lucide icon as a tinted template image; the color follows the theme. */
export function Icon(props: { name: IconName; className?: string; size?: number; color?: string }) {
  return (
    <Image
      src={ICONS[props.name]}
      class={cn("shrink-0", props.className)}
      style={{ width: props.size ?? 16, height: props.size ?? 16, tintColor: props.color ?? token("foreground") }}
    />
  );
}
