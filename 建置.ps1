#requires -Version 5.1
param([switch]$略過桌面, [switch]$驗證圖形加速)
$ErrorActionPreference = 'Stop'
$命令 = Get-Command aqua -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $命令) { throw '找不到 aqua；請將支援姿態及 ONNX 推論的星泉編譯器加入 PATH。' }
$編譯器 = $命令.Source
function 執行編譯器([string[]]$參數) {
    # Windows PowerShell 會將原生標準錯誤轉為錯誤紀錄；先收集，再依結束碼判斷。
    $原錯誤處理 = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $輸出 = & $編譯器 @參數 2>&1
        $結束碼 = $LASTEXITCODE
    } finally { $ErrorActionPreference = $原錯誤處理 }
    if ($結束碼 -ne 0 -or ($輸出 -join "`n") -match '(?m)^ERROR:') { $輸出 | ForEach-Object { Write-Host $_ }; throw '星泉建置或推論驗證失敗。' }
    return ($輸出 -join "`n")
}
function 準備模型([string]$名稱, [string]$網址, [string]$雜湊) {
    $模型 = Join-Path $PSScriptRoot ('模型/' + $名稱 + '.onnx')
    if (-not (Test-Path -LiteralPath $模型)) {
        New-Item -ItemType Directory -Force -Path (Split-Path $模型) | Out-Null
        $暫存 = $模型 + '.下載中'
        $原通訊協定 = [Net.ServicePointManager]::SecurityProtocol
        try {
            [Net.ServicePointManager]::SecurityProtocol = $原通訊協定 -bor [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest $網址 -UseBasicParsing -OutFile $暫存
            if ((Get-FileHash -LiteralPath $暫存 -Algorithm SHA256).Hash.ToLowerInvariant() -ne $雜湊) { throw ($名稱 + '模型校驗失敗。') }
            Move-Item -LiteralPath $暫存 -Destination $模型
        } finally {
            [Net.ServicePointManager]::SecurityProtocol = $原通訊協定
            if (Test-Path -LiteralPath $暫存) { Remove-Item -LiteralPath $暫存 -Force }
        }
    }
    if ((Get-FileHash -LiteralPath $模型 -Algorithm SHA256).Hash.ToLowerInvariant() -ne $雜湊) { throw ($名稱 + '模型校驗失敗。') }
}
$原編碼 = [Console]::OutputEncoding
Push-Location $PSScriptRoot
try {
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    準備模型 '姿態' 'https://media.githubusercontent.com/media/opencv/opencv_zoo/1f19f821d68288feff2ef5c53993b33da74b1509/models/pose_estimation_mediapipe/pose_estimation_mediapipe_2023mar.onnx' '9d89c599319a18fb7d2e28451a883476164543182bafca5f09eb2cf767ed2f3f'
    準備模型 '人物偵測' 'https://media.githubusercontent.com/media/opencv/opencv_zoo/8e2b658d1007864a24cc2cf0e5b4288c74b32584/models/person_detection_mediapipe/person_detection_mediapipe_2023mar.onnx' '47fd5599d6fa17608f03e0eb0ae230baa6e597d7e8a2c8199fe00abea55a701f'
    準備模型 '臉部偵測' 'https://github.com/yakhyo/mediapipe-face-mesh-onnx/releases/download/weights/face_detection_short_range.onnx' '2f2689b040becf555706d2cb978d2f0e3296ea82413734fba9a856c66c5f2b17'
    準備模型 '臉部關鍵點' 'https://github.com/yakhyo/mediapipe-face-mesh-onnx/releases/download/weights/face_mesh_Nx3x192x192.onnx' '3ca77cf59c18e4da0eccb46695bf604683fa564253e3385892981a5c274fb10f'
    if (-not (Get-Command node -CommandType Application -ErrorAction SilentlyContinue)) { throw '找不到 node；請安裝 Node.js 以準備臉部模型。' }
    & node (Join-Path $PSScriptRoot '準備臉部模型.mjs')
    if ($LASTEXITCODE -ne 0) { throw '臉部影像輸入模型準備失敗。' }
    New-Item -ItemType Directory -Force -Path dist | Out-Null
    $原始碼 = @('星泉視覺實驗室.aqua','中文介面.aqua','姿態模型.aqua','臉部模型.aqua','姿態驗證.aqua','臉部驗證.aqua','圖形加速驗證.aqua','臉部圖形加速驗證.aqua')
    執行編譯器 (@('build') + $原始碼 + @('--root','.','--assets','模型','--entry','星泉視覺實驗室.aqua','-o','dist/星泉視覺實驗室.wasm')) | Out-Null
    foreach ($範例 in @('姿態','臉部')) {
        $驗證 = 執行編譯器 @('run','dist/星泉視覺實驗室.wasm','--entry',($範例 + '驗證.aqua'))
        if ($驗證 -notmatch ($範例 + '模型推論驗證通過')) { throw ($範例 + '模型推論驗證失敗。') }
    }
    if ($驗證圖形加速) {
        foreach ($驗證項目 in @(@('圖形加速驗證.aqua','圖形加速姿態推論驗證通過'),@('臉部圖形加速驗證.aqua','圖形加速臉部推論驗證通過'))) {
            $驗證 = 執行編譯器 @('run','dist/星泉視覺實驗室.wasm','--entry',$驗證項目[0])
            if ($驗證 -notmatch $驗證項目[1]) { throw '圖形加速推論驗證失敗。' }
        }
    }
    執行編譯器 @('build','dist/星泉視覺實驗室.wasm','--target','web','-o','web') | Out-Null
    $首頁 = Join-Path $PSScriptRoot 'web/index.html'
    $內容 = [IO.File]::ReadAllText($首頁).Replace('lang="en"','lang="zh-Hant"').Replace('<title>Aquarius WebAssembly</title>','<title>星泉視覺實驗室</title>')
    [IO.File]::WriteAllText($首頁, $內容, [Text.UTF8Encoding]::new($false))
    if (-not $略過桌面) { 執行編譯器 @('build','dist/星泉視覺實驗室.wasm','--target','windows','-o','dist/星泉視覺實驗室.exe') | Out-Null }
    Write-Host '完成：星泉視覺實驗室桌面與網頁版本，姿態及臉部模型推論驗證通過。'
} finally { [Console]::OutputEncoding = $原編碼; Pop-Location }
