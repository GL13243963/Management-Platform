# V2 source branch

This branch contains the OS frontend and shared backend, operations v0.1.9,
tool matrix, render gallery, and expense assistant frontend v0.1.2 plus
the menu, attachment and run-observability worker changes.

The OS login frontend matches maintenance v2-20261117-2. Production activation
and browser verification remain separate from Git commits.

Build the OS with npm run build in frontend. Each independent module has its
own frontend directory and package-lock.json. Use Node 24.22.1.

The expense assistant requires separately managed M-baoxiao source and its
PDF dependencies. Generate cloud-probe/traffic-bundle.mjs by running
apps/expense-assistant/build-traffic.mjs with those dependencies available.
The generated bundle and release archives are managed outside this branch.

Use APP_DB_PATH with a fresh database for testing. Module defaults are legacy,
and gallery and tool seed arrays are empty. Tests requiring original seed data
or private reports need separately supplied fixtures.

This branch adds no business database, upload attachment, PDF or Excel data.
The inherited main history still contains old tracked database and report files.
Review that historical exposure independently before changing repository access.
