# Anthropic Computer Use Demo + Chrome Extension Bridge

> [!NOTE]
> Now featuring support for the new Claude 4 models! The latest Claude Sonnet 4.5 (claude-sonnet-4-5-20250929) is now the default model, with Claude Sonnet 4 (claude-sonnet-4-20250514), Claude Opus 4 (claude-opus-4-20250514), and the new Claude Haiku 4.5 (claude-haiku-4-5-20251001) also available. These models bring next-generation capabilities with the updated str_replace_based_edit_tool that replaces the previous str_replace_editor tool. The undo_edit command has been removed in this latest version for a more streamlined experience.

> [!CAUTION]
> Computer use is a beta feature. Please be aware that computer use poses unique risks that are distinct from standard API features or chat interfaces. These risks are heightened when using computer use to interact with the internet. To minimize risks, consider taking precautions such as:
>
> 1. Use a dedicated virtual machine or container with minimal privileges to prevent direct system attacks or accidents.
> 2. Avoid giving the model access to sensitive data, such as account login information, to prevent information theft.
> 3. Limit internet access to an allowlist of domains to reduce exposure to malicious content.
> 4. Ask a human to confirm decisions that may result in meaningful real-world consequences as well as any tasks requiring affirmative consent, such as accepting cookies, executing financial transactions, or agreeing to terms of service.
>
> In some circumstances, Claude will follow commands found in content even if it conflicts with the user's instructions. For example, instructions on webpages or contained in images may override user instructions or cause Claude to make mistakes. We suggest taking precautions to isolate Claude from sensitive data and actions to avoid risks related to prompt injection.
>
> Finally, please inform end users of relevant risks and obtain their consent prior to enabling computer use in your own products.

This repository helps you get started with computer use on Claude, with reference implementations of:

- Build files to create a Docker container with all necessary dependencies
- A computer use agent loop using the Claude API, Bedrock, or Vertex to access Claude 3.5 Sonnet, Claude 3.7 Sonnet, Claude Sonnet 4, Claude Opus 4, and Claude Haiku 4.5 models
- Anthropic-defined computer use tools
- A streamlit app for interacting with the agent loop

Please use [this form](https://forms.gle/BT1hpBrqDPDUrCqo7) to provide feedback on the quality of the model responses, the API itself, or the quality of the documentation - we cannot wait to hear from you!

> [!IMPORTANT]
> The Beta API used in this reference implementation is subject to change. Please refer to the [API release notes](https://docs.claude.com/en/release-notes/api) for the most up-to-date information.

> [!IMPORTANT]
> The components are weakly separated: the agent loop runs in the container being controlled by Claude, can only be used by one session at a time, and must be restarted or reset between sessions if necessary.

## Quickstart (no Docker)

We now run everything locally. The Python service only translates natural language into browser actions; Chrome executes those via the extension.

1) Build the extension UI
```sh
npm install
npm run build
```

2) Python planner service
```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r client/requirements.txt
export ANTHROPIC_API_KEY=your_key_here   # optional; falls back to simple rules
python client/server.py                  # listens on ws://127.0.0.1:8765
```

3) Load the extension
- Open `chrome://extensions`, enable Developer Mode, Load Unpacked, select this folder
- Open the side panel, enter a task

### Bedrock

> [!TIP]
> To use the new Claude 3.7 Sonnet on Bedrock, you first need to [request model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access-modify.html).

You'll need to pass in AWS credentials with appropriate permissions to use Claude on Bedrock.
You have a few options for authenticating with Bedrock. See the [boto3 documentation](https://boto3.amazonaws.com/v1/documentation/api/latest/guide/credentials.html#environment-variables) for more details and options.

#### Option 1: (suggested) Use the host's AWS credentials file and AWS profile

```bash
export AWS_PROFILE=<your_aws_profile>
docker run \
    -e API_PROVIDER=bedrock \
    -e AWS_PROFILE=$AWS_PROFILE \
    -e AWS_REGION=us-west-2 \
    -v $HOME/.aws:/home/computeruse/.aws \
    -v $HOME/.anthropic:/home/computeruse/.anthropic \
    -p 5900:5900 \
    -p 8501:8501 \
    -p 6080:6080 \
    -p 8080:8080 \
    -it ghcr.io/anthropics/anthropic-quickstarts:computer-use-demo-latest
```

Once the container is running, see the [Accessing the demo app](#accessing-the-demo-app) section below for instructions on how to connect to the interface.

#### Option 2: Use an access key and secret

```bash
export AWS_ACCESS_KEY_ID=%your_aws_access_key%
export AWS_SECRET_ACCESS_KEY=%your_aws_secret_access_key%
export AWS_SESSION_TOKEN=%your_aws_session_token%
docker run \
    -e API_PROVIDER=bedrock \
    -e AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID \
    -e AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY \
    -e AWS_SESSION_TOKEN=$AWS_SESSION_TOKEN \
    -e AWS_REGION=us-west-2 \
    -v $HOME/.anthropic:/home/computeruse/.anthropic \
    -p 5900:5900 \
    -p 8501:8501 \
    -p 6080:6080 \
    -p 8080:8080 \
    -it ghcr.io/anthropics/anthropic-quickstarts:computer-use-demo-latest
```

Once the container is running, see the [Accessing the demo app](#accessing-the-demo-app) section below for instructions on how to connect to the interface.

### Vertex

You'll need to pass in Google Cloud credentials with appropriate permissions to use Claude on Vertex.

```bash
docker build . -t computer-use-demo
gcloud auth application-default login
export VERTEX_REGION=%your_vertex_region%
export VERTEX_PROJECT_ID=%your_vertex_project_id%
docker run \
    -e API_PROVIDER=vertex \
    -e CLOUD_ML_REGION=$VERTEX_REGION \
    -e ANTHROPIC_VERTEX_PROJECT_ID=$VERTEX_PROJECT_ID \
    -v $HOME/.config/gcloud/application_default_credentials.json:/home/computeruse/.config/gcloud/application_default_credentials.json \
    -p 5900:5900 \
    -p 8501:8501 \
    -p 6080:6080 \
    -p 8080:8080 \
    -it computer-use-demo
```

Once the container is running, see the [Accessing the demo app](#accessing-the-demo-app) section below for instructions on how to connect to the interface.

This example shows how to use the Google Cloud Application Default Credentials to authenticate with Vertex.
You can also set `GOOGLE_APPLICATION_CREDENTIALS` to use an arbitrary credential file, see the [Google Cloud Authentication documentation](https://cloud.google.com/docs/authentication/application-default-credentials#GAC) for more details.

### Accessing the demo app

Once the container is running, open your browser to [http://localhost:8080](http://localhost:8080) to access the combined interface that includes both the agent chat and desktop view.

### Chrome Extension bridge

The MV3 background connects to `ws://127.0.0.1:8765` and forwards actions to tabs/content scripts. The sidepanel sends tasks to the background.

- WebSocket: `ws://127.0.0.1:8765` (configurable via `PC_SERVER_PORT` in the server)
- Supported actions map 1:1 to the extension primitives below

The container stores settings like the API key and custom system prompt in `~/.anthropic/`. Mount this directory to persist these settings between container runs.

Deprecated: Docker, Streamlit desktop demo, and noVNC are no longer required for this adapter.

## Screen size

Environment variables `WIDTH` and `HEIGHT` can be used to set the screen size. For example:

```bash
docker run \
    -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
    -v $HOME/.anthropic:/home/computeruse/.anthropic \
    -p 5900:5900 \
    -p 8501:8501 \
    -p 6080:6080 \
    -p 8080:8080 \
    -e WIDTH=1920 \
    -e HEIGHT=1080 \
    -it ghcr.io/anthropics/anthropic-quickstarts:computer-use-demo-latest
```

We do not recommend sending screenshots in resolutions above [XGA/WXGA](https://en.wikipedia.org/wiki/Display_resolution_standards#XGA) to avoid issues related to [image resizing](https://docs.claude.com/en/docs/build-with-claude/vision#evaluate-image-size).
Relying on the image resizing behavior in the API will result in lower model accuracy and slower performance than implementing scaling in your tools directly. The `computer` tool implementation in this project demonstrates how to scale both images and coordinates from higher resolutions to the suggested resolutions.

When implementing computer use yourself, we recommend using XGA resolution (1024x768):

- For higher resolutions: Scale the image down to XGA and let the model interact with this scaled version, then map the coordinates back to the original resolution proportionally.
- For lower resolutions or smaller devices (e.g. mobile devices): Add black padding around the display area until it reaches 1024x768.

## Development

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r client/requirements.txt
npm install && npm run build
python client/server.py
```
