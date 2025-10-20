# Contributors Guide
`mini-a` welcomes your contribution. Below steps can be followed to create a pull request.

* Fork this mini-a repository into your account.
* Create a feature branch in your fork (`$ git checkout -b my-new-feature`).
* Hack, hack, hack...
* Test, test, tes....
* Commit your changes (`$ git commit -am 'Add some feature'`).
* Push the feature branch into your fork (`$ git push origin -u my-new-feature`).
* Create new pull request to `main` branch.


## Running tests

Execute the full test suite from the repository root directory using oJob:

```
ojob tests/autoTestAll.yaml
```

Notes:

- Run the command from the main repo folder (where this README/CONTRIBUTING lives) so relative paths resolve correctly.
- Ensure you have OpenAF installed and the `ojob` command available in your PATH.
- The test run will produce an `autoTestAll.results.json` file with the results; review it locally and remove it before your final commit.
