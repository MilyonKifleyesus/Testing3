[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Get-RequiredEnv {
  param([Parameter(Mandatory = $true)][string]$Name)

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required environment variable: $Name"
  }

  return $value
}

function Get-OptionalEnv {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$DefaultValue
  )

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $DefaultValue
  }

  return $value
}

function Invoke-PlaywrightCli {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [switch]$AllowFailure
  )

  $cmdArgs = @('-y', '@playwright/cli@latest') + $Arguments
  $lines = & npx.cmd @cmdArgs 2>&1
  $exitCode = $LASTEXITCODE
  $output = ($lines | ForEach-Object { "$_" }) -join "`n"

  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "playwright-cli failed (exit=$exitCode) with args [$($Arguments -join ' ')]:`n$output"
  }

  return [pscustomobject]@{
    exitCode = $exitCode
    output   = $output
  }
}

function Parse-PlaywrightResultJson {
  param([Parameter(Mandatory = $true)][string]$Output)

  $lines = $Output -split "`r`n|`n|`r"
  for ($i = 0; $i -lt $lines.Length; $i++) {
    if ($lines[$i].Trim() -ne '### Result') {
      continue
    }

    for ($j = $i + 1; $j -lt $lines.Length; $j++) {
      $candidate = $lines[$j].Trim()
      if ([string]::IsNullOrWhiteSpace($candidate)) {
        continue
      }
      if ($candidate.StartsWith('{') -or $candidate.StartsWith('[') -or $candidate.StartsWith('"')) {
        return $candidate | ConvertFrom-Json
      }
      break
    }
  }

  throw "Unable to parse playwright-cli result payload.`n$Output"
}

function Get-PlaywrightErrorPayload {
  param([Parameter(Mandatory = $true)][string]$Output)

  $lines = $Output -split "`r`n|`n|`r"
  for ($i = 0; $i -lt $lines.Length; $i++) {
    if ($lines[$i].Trim() -ne '### Error') {
      continue
    }

    $errorLines = New-Object System.Collections.Generic.List[string]
    for ($j = $i + 1; $j -lt $lines.Length; $j++) {
      $line = $lines[$j]
      if ($line.Trim().StartsWith('### ')) {
        break
      }
      $errorLines.Add($line)
    }

    $payload = ($errorLines | ForEach-Object { "$_" }) -join "`n"
    if (-not [string]::IsNullOrWhiteSpace($payload)) {
      return $payload.Trim()
    }
    return 'playwright-cli returned an error with no payload.'
  }

  return $null
}

function Invoke-RunCode {
  param(
    [Parameter(Mandatory = $true)][string]$SessionId,
    [Parameter(Mandatory = $true)][string]$Code
  )

  $singleLineCode = ($Code -replace "`r`n", ' ' -replace "`n", ' ').Trim()
  $result = Invoke-PlaywrightCli -Arguments @("-s=$SessionId", 'run-code', $singleLineCode) -AllowFailure
  if ($result.exitCode -ne 0) {
    throw "run-code failed:`n$($result.output)"
  }

  $playwrightError = Get-PlaywrightErrorPayload -Output $result.output
  if (-not [string]::IsNullOrWhiteSpace($playwrightError)) {
    throw "run-code returned an error:`n$playwrightError"
  }

  try {
    return Parse-PlaywrightResultJson -Output $result.output
  } catch {
    throw "Unable to parse run-code payload:`n$($result.output)"
  }
}

function Convert-ToJsStringLiteral {
  param([Parameter(Mandatory = $true)][string]$Value)

  $escaped = $Value -replace '\\', '\\\\' -replace "'", "\\'"
  return "'$escaped'"
}

if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
  throw 'npx is required but was not found in PATH.'
}

$username = Get-RequiredEnv -Name 'BP_TEST_USERNAME'
$password = Get-RequiredEnv -Name 'BP_TEST_PASSWORD'
$baseUrl = (Get-OptionalEnv -Name 'BP_BASE_URL' -DefaultValue 'http://localhost:4200').TrimEnd('/')
$dashboardUrl = "$baseUrl/admin/dashboard"

$projectCallThreshold = 6
$projectAbortThreshold = 1
$projectWindowMs = 12000

$sessionId = "bp-admin-verify-$([Guid]::NewGuid().ToString('N'))"

$checks = New-Object System.Collections.Generic.List[object]
function Add-Check {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][bool]$Pass,
    [string]$Details = ''
  )

  $checks.Add([pscustomobject]@{
    name    = $Name
    pass    = $Pass
    details = $Details
  })

  if ($Pass) {
    Write-Host "[PASS] $Name - $Details"
  } else {
    Write-Host "[FAIL] $Name - $Details" -ForegroundColor Red
  }
}

Write-Host "[verify:admin:ui] Base URL: $baseUrl"
Write-Host "[verify:admin:ui] Session: $sessionId"
Write-Host "[verify:admin:ui] Churn threshold: calls <= $projectCallThreshold, aborts <= $projectAbortThreshold in ${projectWindowMs}ms window"

$openResult = Invoke-PlaywrightCli -Arguments @("-s=$sessionId", 'open', $dashboardUrl) -AllowFailure
if ($openResult.exitCode -ne 0) {
  if ($openResult.output -match 'install-browser|executable') {
    Write-Host '[verify:admin:ui] Browser binary missing; installing Playwright browser...'
    Invoke-PlaywrightCli -Arguments @('install-browser') | Out-Null
    Invoke-PlaywrightCli -Arguments @("-s=$sessionId", 'open', $dashboardUrl) | Out-Null
  } else {
    throw "Failed to open dashboard in playwright-cli:`n$($openResult.output)"
  }
}

$baseUrlJs = Convert-ToJsStringLiteral -Value $baseUrl
$usernameJs = Convert-ToJsStringLiteral -Value $username
$passwordJs = Convert-ToJsStringLiteral -Value $password

$setupNetworkCode = @'
async (page) => {
  if (page.__bpVerifyState && page.__bpVerifyState.attached) {
    return { attached: true, reused: true };
  }
  const state = {
    attached: true,
    loginAt: Date.now(),
    windowStart: Date.now(),
    apiEvents: [],
    projectEvents: []
  };
  page.__bpVerifyState = state;
  const apiPattern = /\/api\//i;
  const projectPattern = /\/api\/Projects(\?|$|\/)/i;
  page.on('response', (response) => {
    const url = response.url();
    if (!apiPattern.test(url)) return;
    const entry = { kind: 'response', ts: Date.now(), url, status: response.status() };
    state.apiEvents.push(entry);
    if (projectPattern.test(url)) state.projectEvents.push(entry);
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!apiPattern.test(url)) return;
    const failure = request.failure();
    const entry = { kind: 'requestfailed', ts: Date.now(), url, errorText: failure?.errorText || 'requestfailed' };
    state.apiEvents.push(entry);
    if (projectPattern.test(url)) state.projectEvents.push(entry);
  });
  return { attached: true, reused: false };
}
'@

$loginCodeTemplate = @'
async (page) => {
  const baseUrl = __BASE_URL__;
  const username = __USERNAME__;
  const password = __PASSWORD__;
  const dashboardUrl = baseUrl.replace(/\/+$/, '') + '/admin/dashboard';
  await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const rawUrl = page.url();
  const pathnameMatch = rawUrl.match(/^[a-z]+:\/\/[^/]+(\/[^?#]*)/i);
  const pathname = pathnameMatch ? pathnameMatch[1] : rawUrl;
  const hasLoginForm =
    (await page.locator('input[formcontrolname="username"]').count()) > 0 &&
    (await page.locator('input[formcontrolname="password"]').count()) > 0;
  let didLogin = false;
  if (pathname.includes('/custom/sign-in') || hasLoginForm) {
    await page.fill('input[formcontrolname="username"]', username);
    await page.fill('input[formcontrolname="password"]', password);
    await Promise.all([
      page.waitForURL((url) => url.pathname.includes('/admin/dashboard'), { timeout: 60000 }),
      page.click('button[type="submit"]'),
    ]);
    didLogin = true;
  }
  await page.waitForURL((url) => url.pathname.includes('/admin/dashboard'), { timeout: 60000 });
  if (page.__bpVerifyState) {
    page.__bpVerifyState.loginAt = Date.now();
  }
  return { didLogin, url: page.url() };
}
'@

$loginCode = $loginCodeTemplate.
  Replace('__BASE_URL__', $baseUrlJs).
  Replace('__USERNAME__', $usernameJs).
  Replace('__PASSWORD__', $passwordJs)

$coreUiCode = @'
async (page) => {
  await page.waitForSelector('#projectFilter', { state: 'visible', timeout: 60000 });
  await page.waitForSelector('#vehicleFilter', { state: 'visible', timeout: 60000 });
  await page.waitForSelector('app-fluorescence-map.dashboard-map-embed', { state: 'visible', timeout: 60000 });
  await page.waitForSelector('app-fluorescence-map.dashboard-map-embed button[aria-label="Toggle filters"]', { state: 'visible', timeout: 60000 });
  return { ok: true };
}
'@

$projectSelectionCode = @'
async (page) => {
  const projectSelect = page.locator('#projectFilter');
  const firstProject = await projectSelect.evaluate((element) => {
    const select = element;
    const options = Array.from(select.options).map((option) => ({
      value: String(option.value || '').trim(),
      label: String(option.textContent || '').trim(),
    }));
    return options.find((option) => option.value && option.value.toLowerCase() !== 'all') || null;
  });
  if (!firstProject) {
    throw new Error('No non-all project options found');
  }
  await projectSelect.selectOption(firstProject.value);
  await page.waitForFunction(() => {
    const element = document.querySelector('#vehicleFilter');
    return !!element && !element.disabled;
  }, { timeout: 45000 });
  return {
    selectedProject: firstProject.value,
    selectedProjectLabel: firstProject.label
  };
}
'@

$fullscreenFiltersCode = @'
async (page) => {
  const mapWidget = page.locator('.widget-container:has(app-fluorescence-map.dashboard-map-embed)').first();
  if ((await mapWidget.count()) === 0) {
    throw new Error('Map widget container was not found');
  }
  await mapWidget.scrollIntoViewIfNeeded();
  await mapWidget.locator('button[title="Toggle fullscreen"]').first().click();
  await page.waitForSelector('.fullscreen-overlay .fullscreen-content app-fluorescence-map.dashboard-map-embed', {
    state: 'visible',
    timeout: 60000,
  });
  const fullscreenFilterButton = page
    .locator('.fullscreen-overlay app-fluorescence-map.dashboard-map-embed button[aria-label="Toggle filters"]')
    .first();
  await fullscreenFilterButton.click();
  await page.waitForSelector('#war-room-filters-panel .fleet-filter-overlay-body', {
    state: 'visible',
    timeout: 60000,
  });
  const scrollProbe = await page.locator('#war-room-filters-panel .fleet-filter-overlay-body').evaluate((element) => {
    const styles = getComputedStyle(element);
    const before = element.scrollTop;
    element.scrollTop = before + 120;
    const after = element.scrollTop;
    return {
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      overflowY: styles.overflowY,
      moved: after > before,
    };
  });
  const canScroll =
    scrollProbe.moved ||
    (scrollProbe.scrollHeight > scrollProbe.clientHeight && /(auto|scroll)/i.test(scrollProbe.overflowY || ''));
  if (!canScroll) {
    throw new Error('Filter overlay body is not scrollable');
  }
  const clientSection = page
    .locator('#war-room-filters-panel .filters-section')
    .filter({ has: page.locator('.form-label', { hasText: 'Client' }) })
    .first();
  const clientChip = clientSection.locator('.filter-chip').first();
  if ((await clientChip.count()) === 0) {
    throw new Error('No client chip available in filters panel');
  }
  await clientChip.waitFor({ state: 'visible', timeout: 30000 });
  const label = (await clientChip.locator('.chip-label').innerText().catch(async () => clientChip.innerText())).trim();
  await clientChip.click();
  await page.click('#war-room-filters-panel .filters-actions .btn.btn-primary');
  await page.waitForSelector('.active-filters-bar .active-filter-chip', { state: 'visible', timeout: 30000 });
  return { selectedClientChip: label, scrollProbe };
}
'@

$setWindowStartCode = @'
async (page) => {
  if (page.__bpVerifyState) {
    page.__bpVerifyState.windowStart = Date.now();
  }
  return { ok: true };
}
'@

$collectMetricsCode = @'
async (page) => {
  const state = page.__bpVerifyState || { loginAt: Date.now(), windowStart: Date.now(), apiEvents: [], projectEvents: [] };
  const postLoginEvents = state.apiEvents.filter((event) => event.ts >= state.loginAt);
  const authFailures = postLoginEvents.filter((event) =>
    event.kind === 'response' && (event.status === 401 || event.status === 403 || event.status >= 500)
  );
  const requestFailures = postLoginEvents.filter((event) =>
    event.kind === 'requestfailed' && !/ERR_ABORTED/i.test(event.errorText || '')
  );
  const projectWindowEvents = state.projectEvents.filter((event) => event.ts >= state.windowStart);
  const projectResponses = projectWindowEvents.filter((event) => event.kind === 'response');
  const project200 = projectResponses.filter((event) => event.status === 200);
  const projectAborts = projectWindowEvents.filter((event) =>
    event.kind === 'requestfailed' && /ERR_ABORTED/i.test(event.errorText || '')
  );
  return {
    finalUrl: page.url(),
    authFailures,
    requestFailures,
    projectCallsInWindow: projectResponses.length,
    project200InWindow: project200.length,
    projectAbortsInWindow: projectAborts.length
  };
}
'@

try {
  $networkSetup = Invoke-RunCode -SessionId $sessionId -Code $setupNetworkCode
  Add-Check -Name 'Network listener setup' -Pass ($networkSetup.attached -eq $true) -Details ("reused=" + [string]$networkSetup.reused)

  $loginResult = Invoke-RunCode -SessionId $sessionId -Code $loginCode
  Add-Check -Name 'Login' -Pass $true -Details ($(if ($loginResult.didLogin) { 'Signed in and redirected to dashboard' } else { 'Existing authenticated session' }))
  Add-Check -Name 'Dashboard URL' -Pass ($loginResult.url -match '/admin/dashboard') -Details $loginResult.url
  if ($loginResult.url -notmatch '/admin/dashboard') {
    throw "Expected URL to include /admin/dashboard but got: $($loginResult.url)"
  }

  Invoke-RunCode -SessionId $sessionId -Code $coreUiCode | Out-Null
  Add-Check -Name 'Core dashboard controls' -Pass $true -Details 'Project dropdown, vehicle dropdown, map widget, and toolbar are visible'

  $projectSelection = Invoke-RunCode -SessionId $sessionId -Code $projectSelectionCode
  Add-Check -Name 'Project selection' -Pass $true -Details ("Selected " + $projectSelection.selectedProjectLabel + " (" + $projectSelection.selectedProject + ")")
  Add-Check -Name 'Vehicle enabled after project select' -Pass $true -Details 'Vehicle dropdown became enabled'

  $fullscreenResult = Invoke-RunCode -SessionId $sessionId -Code $fullscreenFiltersCode
  Add-Check -Name 'Fullscreen filters flow' -Pass $true -Details 'Opened fullscreen, filters panel, selected client chip, and applied filters'
  Add-Check -Name 'Filter overlay scroll' -Pass $true -Details ("scrollHeight=" + $fullscreenResult.scrollProbe.scrollHeight + ", clientHeight=" + $fullscreenResult.scrollProbe.clientHeight)
  $selectedClientChip = if ([string]::IsNullOrWhiteSpace([string]$fullscreenResult.selectedClientChip)) {
    'n/a'
  } else {
    [string]$fullscreenResult.selectedClientChip
  }
  Add-Check -Name 'Show Results applies filters' -Pass $true -Details ("Client chip: " + $selectedClientChip)

  Invoke-RunCode -SessionId $sessionId -Code $setWindowStartCode | Out-Null
  Start-Sleep -Milliseconds $projectWindowMs
  $metrics = Invoke-RunCode -SessionId $sessionId -Code $collectMetricsCode

  $authHealthy = ($metrics.authFailures.Count -eq 0)
  Add-Check -Name 'API auth/5xx health' -Pass $authHealthy -Details ($(if ($authHealthy) { 'No post-login 401/403/5xx API responses' } else { ($metrics.authFailures | ConvertTo-Json -Compress) }))
  if (-not $authHealthy) {
    throw 'Detected post-login 401/403/5xx API responses.'
  }

  $churnWithinThreshold = ($metrics.projectCallsInWindow -le $projectCallThreshold)
  Add-Check -Name 'Projects call volume threshold' -Pass $churnWithinThreshold -Details ("calls=" + $metrics.projectCallsInWindow + ", threshold=" + $projectCallThreshold + ", windowMs=" + $projectWindowMs)
  if (-not $churnWithinThreshold) {
    throw 'Projects call volume exceeded threshold.'
  }

  $abortWithinThreshold = ($metrics.projectAbortsInWindow -le $projectAbortThreshold)
  Add-Check -Name 'Projects aborted-call threshold' -Pass $abortWithinThreshold -Details ("aborts=" + $metrics.projectAbortsInWindow + ", threshold=" + $projectAbortThreshold)
  if (-not $abortWithinThreshold) {
    throw 'Projects aborted-call count exceeded threshold.'
  }

  if ($metrics.requestFailures.Count -gt 0) {
    Write-Host "[WARN] Non-aborted API request failures detected post-login: $($metrics.requestFailures.Count)" -ForegroundColor Yellow
  }

  Write-Host "[verify:admin:ui] Project churn window stats: calls=$($metrics.projectCallsInWindow), 200s=$($metrics.project200InWindow), aborts=$($metrics.projectAbortsInWindow)"
  Write-Host "[verify:admin:ui] Final URL: $($metrics.finalUrl)"
  Write-Host '[verify:admin:ui] Summary: all checks passed'
  exit 0
} catch {
  Write-Host "[verify:admin:ui] Failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  Invoke-PlaywrightCli -Arguments @("-s=$sessionId", 'close') -AllowFailure | Out-Null
}
