import { MocklensError } from './config.js';

const GLOBAL_HELP = `mocklens — static mobile UI mockup tool

Usage: mocklens <command> [options]
       mocklens <command> --help

Commands:
  init         Initialize config and shared screen files
  new-screen   Create one or more device-targeted screens
  list         List discovered screens and configured devices
  screenshot   Render PNG screenshots
  validate     Check screens for browser-detectable layout problems
  check        Run screenshot and validate together
  checkpoint ux       Record UX requirement evidence
  checkpoint visual   Record visual review evidence
  serve        Open the local viewer and annotation queue

Global options:
  --config <path>   Path to mocklens.config.json
  -h, --help        Show help for the selected command

Run "mocklens <command> --help" for command-specific options and examples.
`;

const INIT_HELP = `mocklens init — initialize a Mocklens project

Usage:
  mocklens init [--config <path>] [--dir <path>] [--force]

Description:
  Creates mocklens.config.json, shared.css, and screen guidance. It does not
  create HTML screens. Existing valid projects are left unchanged unless
  --force is used.

Options:
  --config <path>   Config file to create or inspect (default mocklens.config.json)
  --dir <path>      Screen directory relative to the config (default screens)
  --force           Replace init-owned config and shared files
  -h, --help        Show this help

Examples:
  mocklens init
  mocklens init --dir mocks/mobile
  mocklens init --config design/mocklens.config.json
`;

const NEW_SCREEN_HELP = `mocklens new-screen — create device-targeted screen files

Usage:
  mocklens new-screen <name>... --device <name> [options]

Options:
  --config <path>      Path to mocklens.config.json
  --device <name>      Configured primary device (required; exactly one)
  --form-factor <name> Form-factor metadata (default phone)
  -h, --help           Show this help

Examples:
  mocklens new-screen settings --device iphone-14
  mocklens new-screen today add-expense states/empty --device iphone-14
`;

const LIST_HELP = `mocklens list — list screens and devices

Usage:
  mocklens list [--config <path>]

Options:
  --config <path>   Path to mocklens.config.json
  -h, --help        Show this help

Example:
  mocklens list --config example/mocklens.config.json
`;

const SCREENSHOT_HELP = `mocklens screenshot — render screen screenshots

Usage:
  mocklens screenshot [options]

Options:
  --config <path>   Path to mocklens.config.json
  --screen <name>   Limit to a screen (repeatable)
  --device <name>   Limit to a configured device (repeatable)
  --full-page       Also capture full-page screenshots
  -h, --help        Show this help

Examples:
  mocklens screenshot
  mocklens screenshot --screen today.iphone-14 --device iphone-14
`;

const VALIDATE_HELP = `mocklens validate — check rendered screen layout

Usage:
  mocklens validate [options]

Options:
  --config <path>   Path to mocklens.config.json
  --screen <name>   Limit to a screen (repeatable)
  --device <name>   Limit to a configured device (repeatable)
  -h, --help        Show this help

Examples:
  mocklens validate
  mocklens validate --screen today.iphone-14 --device iphone-14
`;

const CHECK_HELP = `mocklens check — screenshot, validate, and evaluate readiness

Usage:
  mocklens check [options]

Options:
  --config <path>   Path to mocklens.config.json
  --screen <name>   Limit to a screen (repeatable)
  --device <name>   Limit to a configured device (repeatable)
  --full-page       Also capture full-page screenshots
  -h, --help        Show this help

Examples:
  mocklens check
  mocklens check --screen today.iphone-14 --device iphone-14
`;

const CHECKPOINT_HELP = `mocklens checkpoint — record review evidence

Usage:
  mocklens checkpoint <ux|visual> [options]

Subcommands:
  ux <requirement-id>   Record evidence for one mocklens.ux.json requirement
  visual               Record reviewed screen/device screenshot combinations

Options:
  --config <path>       Path to mocklens.config.json
  -h, --help            Show this help

Run "mocklens checkpoint ux --help" or
"mocklens checkpoint visual --help" for subcommand-specific options.
`;

const CHECKPOINT_UX_HELP = `mocklens checkpoint ux — record UX requirement evidence

Usage:
  mocklens checkpoint ux <requirement-id> --proof <text> [--config <path>]

Options:
  --config <path>   Path to mocklens.config.json
  --proof <text>    Specific review evidence (required)
  -h, --help        Show this help

The requirement supplies its own screens and delivery devices from
mocklens.ux.json.

Example:
  mocklens checkpoint ux expense-flow --proof "Add, edit, delete, and Undo states reviewed together."
`;

const CHECKPOINT_VISUAL_HELP = `mocklens checkpoint visual — record visual review evidence

Usage:
  mocklens checkpoint visual --screen <name>... --device <name>... --proof <text>

Options:
  --config <path>   Path to mocklens.config.json
  --screen <name>   Reviewed screen (required; repeatable)
  --device <name>   Reviewed device (required; repeatable)
  --proof <text>    Specific visual review evidence (required)
  -h, --help        Show this help

Example:
  mocklens checkpoint visual --screen today.iphone-14 --device iphone-14 --proof "Hierarchy and fixed navigation reviewed in the current screenshot."
`;

const SERVE_HELP = `mocklens serve — browse and annotate mockups

Usage:
  mocklens serve [--config <path>] [--port <number>]

Description:
  Starts the local viewer at http://localhost:<port>. Run it from the directory
  containing mocklens.config.json, or pass --config from another directory.
  Review notes are stored beside the config in mocklens.notes.json.

Options:
  --config <path>   Path to mocklens.config.json
  --port <number>   Viewer port (default 4173)
  -h, --help        Show this help

Examples:
  mocklens serve
  mocklens serve --config example/mocklens.config.json
  mocklens serve --port 4300
`;

export function helpFor(command: string | undefined, commandArgs: string[]): string {
  if (command === undefined) return GLOBAL_HELP;
  switch (command) {
    case 'init':
      return INIT_HELP;
    case 'new-screen':
      return NEW_SCREEN_HELP;
    case 'list':
      return LIST_HELP;
    case 'screenshot':
      return SCREENSHOT_HELP;
    case 'validate':
      return VALIDATE_HELP;
    case 'check':
      return CHECK_HELP;
    case 'serve':
      return SERVE_HELP;
    case 'checkpoint':
      if (commandArgs[0] === undefined) return CHECKPOINT_HELP;
      if (commandArgs[0] === 'ux') return CHECKPOINT_UX_HELP;
      if (commandArgs[0] === 'visual') return CHECKPOINT_VISUAL_HELP;
      throw new MocklensError(`unknown checkpoint subcommand: ${commandArgs[0]}`);
    default:
      throw new MocklensError(`unknown command: ${command}`);
  }
}

export { GLOBAL_HELP };
