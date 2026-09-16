/**
 * The structure used when a repository has no PR template of its own.
 *
 * Kept as a source constant rather than a file on disk so it is compiled into
 * the agent bundle and cannot go missing in a global install. Edit it here to
 * change the default shape of every generated description.
 */
export const DEFAULT_PR_TEMPLATE = `## Description

<!-- Provide a brief description of the changes in this PR -->

## Type of Change

<!-- Mark the relevant option with an "x" -->

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Refactoring (no functional changes)

## Related Issues

<!-- Link any related issues using #issue-number -->

Fixes #
Closes #
Related to #

## Changes Made

<!-- List the specific changes made in this PR -->

-
-
-

## Testing

<!-- Describe the tests you ran to verify your changes -->

- [ ] All existing tests pass
- [ ] Added new tests for the changes
- [ ] Manually tested the changes

### Test Coverage

<!-- If applicable, include test coverage information -->

## Screenshots/Demos

<!-- If applicable, add screenshots or demos to help explain your changes -->

## Checklist

<!-- Mark completed items with an "x" -->

- [ ] My code follows the project's code style
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings or errors
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] I have created a changeset (\`pnpm changeset\`)

## Additional Notes

<!-- Add any additional notes, concerns, or discussion points -->
`;
