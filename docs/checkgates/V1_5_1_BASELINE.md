# V1.5.1 baseline

Repository: Engineering-HUB. Branch `main`, starting commit
`adde446e856f992d16aca18b116489126b9a57c7`. Unrelated local modification present and preserved:
`dashboard-app/App.gs` (meta-tag reformatting) was neither staged nor committed.

## Starting local state (before any V1.5.1 change)

| Command | Exit | Actual output |
| --- | ---: | --- |
| `npm ci` | 0 | 364 packages installed, 0 vulnerabilities (existing deprecation warnings) |
| `npm run lint` | 0 | no findings |
| `npm test` | 0 | **387 tests, 387 pass, 0 fail, 0 skipped** |
| `npm run validate` | 0 | 35 manager Apps Script files, 3 dashboard files, both manifests, 689 translation keys |
| `node scripts/manager-web-benchmark.js` | 0 | wrote `V1_5_PERFORMANCE.json` (V1.5 measurements) |

`npm.ps1` is blocked by the local execution policy in this environment, so the equivalent
commands were run through `npm.cmd` and the Node CLI. The recorded outputs are in
[V1_5_1_VALIDATION.txt](V1_5_1_VALIDATION.txt).

## Measured starting behaviour (mock, identical fixtures)

| Projects/tasks | Read RPCs to show overview→projects→tasks | Projects navigation | Tasks navigation |
| --- | ---: | ---: | ---: |
| 10/100 | 4 | 4.30 ms | 2.58 ms |
| 100/1000 | 4 | 25.94 ms | 12.08 ms |
| 300/3000 | 4 | 26.75 ms | 35.97 ms |

Table reads per interactive operation at 300/3000: overview 10 range reads (9 tables plus the
environment marker), projects 8, tasks 4, references 3, one workbook open each.

## Known limits carried into this release

- No live Workspace timing, identity, sharing or publication verification exists in this
  repository; `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR PRODUCTION**.
- The preview browser in this environment clamps the viewport (1366 px is measured through a
  same-origin iframe) and cannot take stable element screenshots, so V1.5.1 visual evidence is
  DOM-measured rather than captured at 1366/1920.
