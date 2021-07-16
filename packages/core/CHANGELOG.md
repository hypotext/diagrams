# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [1.2.0](https://github.com/penrose/penrose/compare/v1.1.0...v1.2.0) (2021-05-24)

### Bug Fixes

- handle Text GPIs with empty strings ([#553](https://github.com/penrose/penrose/issues/553)) ([0a5cfe1](https://github.com/penrose/penrose/commit/0a5cfe19c74c07607b8f5a47bea6e4f34f4cdf99))

### Features

- PathString GPI ([#549](https://github.com/penrose/penrose/issues/549)) ([2e9069d](https://github.com/penrose/penrose/commit/2e9069d7c14436226029b5e0ae2050b2dc6c205c))
- substance program synthesizer ([#551](https://github.com/penrose/penrose/issues/551)) ([09062ee](https://github.com/penrose/penrose/commit/09062eee7bd027396905958cf009305fcc8aa6f6))

# [1.1.0](https://github.com/penrose/penrose/compare/v1.0.0...v1.1.0) (2021-04-21)

### Bug Fixes

- [#481](https://github.com/penrose/penrose/issues/481) - wrong NS attribute ([#485](https://github.com/penrose/penrose/issues/485)) ([e6b4c7a](https://github.com/penrose/penrose/commit/e6b4c7ae252f6789c8145dbe0699a608f4f00490))
- [#520](https://github.com/penrose/penrose/issues/520) (moving types out, fixing soundness) ([#526](https://github.com/penrose/penrose/issues/526)) ([ba0abf3](https://github.com/penrose/penrose/commit/ba0abf3fb666beea4d6e85f60d9cf6840d668dba))
- [style-errors-2] fix style path validation code or remove unsupported style program features so LA example works (`findExpr` accesses lists) [#489](https://github.com/penrose/penrose/issues/489) ([#491](https://github.com/penrose/penrose/issues/491)) ([389f25c](https://github.com/penrose/penrose/commit/389f25c37d74a59155b8df23941a1ff9fc001012))
- add source loc to parser errors; report unexpected EOF ([#510](https://github.com/penrose/penrose/issues/510)) ([8555c84](https://github.com/penrose/penrose/commit/8555c84a3a94ddca5930e8d012168de75c68599d))
- handle CRLF in all parsers ([#500](https://github.com/penrose/penrose/issues/500)) ([da2238a](https://github.com/penrose/penrose/commit/da2238a0e44c380daa59ecf3e6ee6737a8a74d76))
- K&R style braces in GPI exprs ([#544](https://github.com/penrose/penrose/issues/544)) ([ef0ae12](https://github.com/penrose/penrose/commit/ef0ae12d6244ec7689a5e3ae9ad03829ebe61115))
- newlines in errors (wrap now) and newlines in mathjax ([#493](https://github.com/penrose/penrose/issues/493)) ([9fbe49f](https://github.com/penrose/penrose/commit/9fbe49f27cd90500f27e20bdb1010692795d171a))
- skip static check for access paths ([#495](https://github.com/penrose/penrose/issues/495)) ([ffeb55b](https://github.com/penrose/penrose/commit/ffeb55be7df0323e52e312edf17c0fb29b68517d))
- stroke-dasharray rendering ([5815cac](https://github.com/penrose/penrose/commit/5815cac5dc4079226bcc671b0214262138f669b9))
- vector initialization, as well as overriding elements of vector-typed shape properties ([#522](https://github.com/penrose/penrose/issues/522)) ([238145c](https://github.com/penrose/penrose/commit/238145ce1073804dc5ca6ab470b94e555fca3c3e)), closes [#501](https://github.com/penrose/penrose/issues/501) [#515](https://github.com/penrose/penrose/issues/515) [#501](https://github.com/penrose/penrose/issues/501) [#515](https://github.com/penrose/penrose/issues/515) [#515](https://github.com/penrose/penrose/issues/515) [#516](https://github.com/penrose/penrose/issues/516) [#521](https://github.com/penrose/penrose/issues/521) [#2](https://github.com/penrose/penrose/issues/2) [#504](https://github.com/penrose/penrose/issues/504)

### Features

- [layout] add `evalFns` for individual opt fns, and compile each opt function ([#527](https://github.com/penrose/penrose/issues/527)) ([3eec8eb](https://github.com/penrose/penrose/commit/3eec8ebe93870e9ab4ffd6fef26e1f3ac2995c05))
- `evalEnergy` API function ([#512](https://github.com/penrose/penrose/issues/512)) ([2830bf0](https://github.com/penrose/penrose/commit/2830bf0f30a69f53e4928cce0882747764ecaa6e))
- add `strokeDashArray` to all GPIs ([#531](https://github.com/penrose/penrose/issues/531)) ([629d5cc](https://github.com/penrose/penrose/commit/629d5cc469ae3c7ccc2f63c7935c37cc51ff8359))
- Add basic graph domain and more standard library functions for Style ([#502](https://github.com/penrose/penrose/issues/502)) ([859f3ae](https://github.com/penrose/penrose/commit/859f3aefed035136278cf92dc93aa493973125a5)), closes [#501](https://github.com/penrose/penrose/issues/501)
- add Polygon and Polyline to the shape library ([#539](https://github.com/penrose/penrose/issues/539)) ([50bd559](https://github.com/penrose/penrose/commit/50bd55988420569b0aef732b3fd5f336a2ec6121))
- Enhance opt inspector ([#537](https://github.com/penrose/penrose/issues/537)) ([fe05e5c](https://github.com/penrose/penrose/commit/fe05e5c4fbe1e26e10448eaadc1e7025cd86203a))
- Get disjoint AABB rect/line constraints to work; make autodiff more correct; add varying initialization to Style ([#538](https://github.com/penrose/penrose/issues/538)) ([f848970](https://github.com/penrose/penrose/commit/f848970907e0bd484095d6b1188f5fc851dfe4f2)), closes [#504](https://github.com/penrose/penrose/issues/504) [#504](https://github.com/penrose/penrose/issues/504) [#504](https://github.com/penrose/penrose/issues/504) [#496](https://github.com/penrose/penrose/issues/496) [#542](https://github.com/penrose/penrose/issues/542)
- mathtransform with jscodeshift ([#389](https://github.com/penrose/penrose/issues/389)) ([db17b27](https://github.com/penrose/penrose/commit/db17b278bebe04f70d8e8c8135189d403f67aa2e))
- opt tab for inspector; localStorage settings ([#534](https://github.com/penrose/penrose/issues/534)) ([b1e69cd](https://github.com/penrose/penrose/commit/b1e69cd19c0817a32cf74b1b62c6b02b09139a06))
- process prelude values in substance checker ([#533](https://github.com/penrose/penrose/issues/533)) ([2c143ac](https://github.com/penrose/penrose/commit/2c143ac39a5d3ef84ee8277457bfa3460d45d255))

# 1.0.0 (2021-02-15)

**Note:** Version bump only for package @penrose/core

# [1.0.0-alpha.3](https://github.com/penrose/penrose/compare/v1.0.0-alpha.2...v1.0.0-alpha.3) (2021-02-15)

**Note:** Version bump only for package @penrose/core

# [1.0.0-alpha.1](https://github.com/penrose/penrose/compare/v1.0.0-alpha.0...v1.0.0-alpha.1) (2021-02-15)

**Note:** Version bump only for package @penrose/core

## 1.0.1 (2021-01-28)

### Bug Fixes

- install script for roger ([2724feb](https://github.com/penrose/penrose/commit/2724feb19d5ff2c4697a8da563b91e330857091d))
