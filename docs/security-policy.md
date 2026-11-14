# Container vulnerability policy

## Scope

CI scans both application artifacts:

- The runtime image used by the API and worker.
- The migration image used for migrations and seeding.

The scanner image is pinned by digest through the GitHub Actions
repository variable TRIVY_IMAGE.

## Reports

CI generates a machine-readable SBOM and a vulnerability report for
each image.

Reports include all reported vulnerability severities.

## Blocking rules

Publication is blocked when:

- A HIGH or CRITICAL vulnerability is detected in either image.
- The scanner fails to execute or cannot complete the required scan.
- Required scan configuration is missing.
- Another required CI check fails.

LOW, MEDIUM and UNKNOWN findings remain visible in the reports.
They do not block publication under this initial policy.

## Exceptions

The initial implementation permits no vulnerability exceptions.

Any future exception requires a reviewed policy and implementation
change recording:

- Vulnerability identifier and affected package.
- Reason for accepting the risk temporarily.
- Responsible owner.
- Expiry date.
- Planned remediation.

Do not disable the scanner or add blanket exclusions to obtain
a successful pipeline.

## Responsibilities

Iulian maintains scanning, reports and publication gates.

Jaimie maintains container base images and operating-system
package changes.

Sultan maintains application dependency changes.

## Scanner maintenance

Record the selected Trivy version and image digest in delivery evidence.
Update the pin deliberately after reviewing a newer release and
verifying the pipeline.
