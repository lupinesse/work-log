# Copy this file to config.local.ps1 and fill in your values.
# config.local.ps1 is gitignored — never commit it.

# Bearer token for the Nimipäivärajapinta API (nimipaivarajapinta.fi)
$NamedayApiToken = 'your-token-here'

# Anthropic API key for the AI proxy (https://console.anthropic.com)
# Required for the "Make it interesting" and Notion AI features
$AnthropicApiKey = ''

# Notion integration token (https://www.notion.so/my-integrations)
$NotionToken = ''

# Notion database ID — the UUID from your database's URL
# e.g. https://notion.so/your-workspace/YOUR-DATABASE-ID?v=...
$NotionDatabaseId = ''

# Weather widget location (Open-Meteo API)
# Find your coordinates at: https://open-meteo.com/
$WeatherLat  = 60.1887    # decimal degrees latitude
$WeatherLon  = 24.927     # decimal degrees longitude
$WeatherName = 'Helsinki' # display name shown in the widget

# Calendar: how many years back to look for recurring series when probing for
# an occurrence today. Only used on stores where Outlook cannot expand
# recurrences directly. Raise it if long-running recurring meetings are missing
# from the meetings strip; lower it (0 = current year only) if the calendar
# request feels slow. Clamped to 0-20.
$CalendarLookBackYears = 3
