# Checked-in fixture results

These files preserve representative Mocklens CLI output so behavior can be
reviewed without installing dependencies or running Chromium.

Every transcript records its source fixture, generating test file and test
case, command, expected exit code, stdout, and stderr. Tests compare live output
against the files, so CLI changes require an intentional fixture-result update.

See `readiness/` for the delivery-readiness scenarios from issue #19.
