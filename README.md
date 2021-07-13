# validate-env-vars-webpack-plugin

> A webpack plugin to validate usage of environment variables

## Webpack version support

This plugin has only been tested with webpack >= 5.6.0.

## Options

### `knownEnvVars`

- type: _see the sections below for supported values_
- default: `Object.keys(process.env)`

Defines the list of known environment variables.

The plugin will produce an error for any environment variable used that is not in this list.

The field supports different sources for the list of env vars.

#### Array

Validate against a list of environment variables.

Example:

```javascript
knownEnvVars: ["PROJECT_NAME", "SECRET"]
```

#### AWS SecretsManager

Validate environment variables against a secret in AWS SecretsManager. 

The secret should be a key/value secret rather than plain text.

Give `knownEnvVars` an object with the properties:

- `secretId` (required) - the name of the secret in SecretsManager
- `accessKeyId` (required)
- `secretAccessKey` (required)
- `region` (required)
- `sessionToken` (optional)
- `secretVersionId` (optional)
- `secretVersionStage` (optional)

Example:

```javascript
knownEnvVars: {
    secretId: "api-env-vars",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: "eu-west-1"
}
```

#### .env file

Validate environment variables against an .env file.

Give `knownEnvVars` a string file path to the .env file.

For example:

```javascript
knownEnvVars: path.resolve(__dirname, "../.env")
```

### `includePaths`

- type: `[String|RegExp]`
- default: `[]`

Defines the file paths to include in the validation.

```javascript
includePaths: [path.resolve(__dirname, "src")]
```

### `excludePaths`

- type: `[String|RegExp]`
- default: `[]`

Defines the file paths to ignore in the validation.

Example:

```javascript
excludePaths: [path.resolve(__dirname, "src/generated")]
```

### `ignoreEnvVars`

- type: `String[]`
- default: `[]`

A list of environment variable names to exclude from the validation.

Example:

```javascript
ignoreEnvVars: ["RUNTIME_VALUE"]
```

### `knownEnvVarsTimeout`

- type: `Number`
- default: `5000`

When using an external source (eg. AWS SecretsManager) for `knownEnvVars`, this defines the amount of time in milliseconds
to wait for the list of environment variables to be resolved before exiting with an error.

Example:

```javascript
knownEnvVarsTimeout: 2000 // 2 seconds
```

## Usage

Add the plugin to your webpack plugins array. For example:

```javascript
plugins: [
    new ValidateEnvVarsPlugin({
        knownEnvVars: ["PROJECT_NAME", "SECRET"],
        includePaths: [path.resolve(__dirname, "src")]
    })
]
```

## Example error

```shell
ERROR in ./src/app/api.ts
Unrecognised environment variable: WEBSITE_URL
 @ ./src/setup.ts 27:15-35
 @ ./src/index.ts 15:33-55
```

## Author & License

`validate-env-vars-webpack-plugin` was created by [Penfold](https://getpenfold.com) and is released under the MIT license.
