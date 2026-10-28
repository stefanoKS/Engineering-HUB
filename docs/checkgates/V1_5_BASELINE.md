# V1.5 baseline

Repository: Engineering-HUB. Branch main, initially clean. Starting commit 5c1143edef3f8ba74ce92219a59ea58723847941. Initial fetch showed local/remote main aligned (0 ahead, 0 behind). Schema 6; employee contract 1.4. No branch, PR, history reset or force push.

Actual baseline commands on Windows:

- npm ci: exit 0, 364 packages installed, 0 audit vulnerabilities; node-domexception/glob deprecation warnings.
- npm run lint: exit 0.
- npm test: 344 tests, 340 pass, 4 fail, 0 skipped.
- npm run validate: exit 0; 33 manager Apps Script files, 3 dashboard files, 532 translation keys.

Three baseline failures treated the existence of an ignored local .clasp.json as proof it was committed. Tests now inspect tracked Git paths, retaining the no-committed-secret assertion and an exported-tree fallback. The local configuration was neither read nor modified. The fourth scope guard omitted script.container.ui already present in the baseline manifest; the allowed-scope assertion now includes that existing scope. No scope was added for V1.5.

A publication quota-failure mock was extended with setNumberFormat so it still reaches/asserts the original quota failure after the date-format fix. The release version guard now checks 1.5.0 package/publisher while preserving historical V1.4.1 documentary assertions. No regression test was removed or skipped.

Known reported Workspace defect: Snapshot value mismatch in PUBLISHED_PROJECTS_B row 2 column 10 (committedDeadline). The date-conversion cause is covered by a Date-returning Sheets mock and matching employee reader/hash tests. Real Workspace retest remains UNVERIFIED.
