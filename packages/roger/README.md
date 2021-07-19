# roger

The command line for penrose

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/roger.svg)](https://npmjs.org/package/roger)
[![Downloads/week](https://img.shields.io/npm/dw/roger.svg)](https://npmjs.org/package/roger)
[![License](https://img.shields.io/npm/l/roger.svg)](https://github.com/penrose/penrose/blob/main/package.json)

<!-- toc -->

- [roger](#roger)
- [Usage](#usage)
- [Commands](#commands)
<!-- tocstop -->

# Usage

<!-- usage -->

```sh-session
$ npm install -g @penrose/roger
$ roger COMMAND
running command...
$ roger (-v|--version|version)
@penrose/roger/1.0.0 darwin-x64 node-v12.20.0
$ roger --help [COMMAND]
USAGE
  $ roger COMMAND
...
```

<!-- usagestop -->

# Commands

<!-- commands -->

- [`roger help [COMMAND]`](#roger-help-command)
- [`roger watch SUBSTANCE STYLE DOMAIN`](#roger-watch-substance-style-domain)

## `roger help [COMMAND]`

display help for roger

```
USAGE
  $ roger help [COMMAND]

ARGUMENTS
  COMMAND  command to show help for

OPTIONS
  --all  see all commands in CLI
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v3.2.2/src/commands/help.ts)_

## `roger watch SUBSTANCE STYLE DOMAIN`

watches files for changes

```
USAGE
  $ roger watch SUBSTANCE STYLE DOMAIN

OPTIONS
  -h, --help       show CLI help
  -p, --port=port  [default: 9160] websocket port to serve to frontend
```

_See code: [src/commands/watch.ts](https://github.com/penrose/penrose/blob/v1.0.0/src/commands/watch.ts)_

<!-- commandsstop -->
