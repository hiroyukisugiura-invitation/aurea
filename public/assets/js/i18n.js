/* public/assets/js/i18n.js (AUREA v1) */

(() => {
  const I18N = {
    ja: {
      /* ===== Sidebar / Main ===== */
      newChat: "新しいチャット",
      threadNew: "+ 新しいチャット",
      titleMatch: "（タイトル一致）",

      library: "ライブラリ",
      images: "ライブラリ",
      projects: "プロジェクト",
      chats: "チャット",
      search: "検索",

      menuRename: "名前を変更する",
      menuDelete: "削除する",

      share: "シェア",

      /* ===== Ask bar ===== */
      options: "オプション",
      addPhotoFile: "写真とファイルを追加",
      createImage: "画像を作成する",
      input: "入力",
      mic: "マイク（音声入力）",
      voice: "音声モードを使用する",
      send: "送信",
      stop: "停止",
      askNote: "AUREA の回答は\"複数のAI検索情報\"を集約/解析/判断/要約をしていますが、必ずしも正確とは限りませんので、重要な情報は更に確認をしてください。",
      promptEmpty: "（未入力）",
      statusAnalyzing: "解析中",
      statusGenerating: "回答生成中",
      aureaPrefix: "（AUREA）",
      replyPlaceholder: "※ここは後で /api/chat に接続します。",
      imageSaved: "（画像を保存しました）",
      imageSavedInLibrary: "「{images}」→保存ボックスに追加済み。",

      /* ===== Settings ===== */
      settings: "設定",
      logout: "ログアウト",

      general: "一般",
      generalDesc: "端末の基本的な設定",

      apps: "アプリ",
      appsDesc: "各種SaaSと連携、任意でAPI接続が設定可能",

      data: "データ",
      dataDesc: "データ管理や保存先について",

      trainer: "AUREA Data Trainer",
      trainerDesc: "独自に社内AIを育てて業務効率化へ",

      accountSecurity: "アカウント・セキュリティ",
      accountDesc: "利用ユーザー情報とセキュリティ詳細",

      addSaas: "SaaS 追加",

      addCustom: "カスタム追加",

      connected: "接続済み",
      notConnected: "未接続",

      saasCustom: "カスタムSaaS",
      saasNoMatch: "一致するSaaSがありません。",

      confirmReconnectGoogle: "Google を再接続しますか？",
      confirmConnectGoogle: "Google アカウントと接続しますか？",
      confirmConnectSaas: "{name} を接続しますか？",
      confirmDisconnectSaas: "{name} を解除しますか？",

      saasName: "SaaS名",
      saasNamePh: "例）Custom CRM",
      apiBaseUrl: "API Base URL",
      apiBaseUrlPh: "https://api.example.com",
      authMode: "認証方式",
      authApiKey: "API Key",
      authBearer: "Bearer Token",
      apiToken: "API Key / Token",
      apiTokenPh: "********",
      save: "保存",

      createProject: "プロジェクトを作成する",
      projectName: "プロジェクト名",

      dataNowCloud: "現在：クラウド",
      dataNowLocal: "現在：端末内",
      deleteAllChats: "すべてのチャットを削除する",

      trainerSection: "AUREAを育てる（AET）",
      trainerSectionDesc: "「こんな質問にはこれ」といったケースを登録し、社内AIの回答精度を育てます",

      trainerAddCase: "ケースを追加",
      trainerAddCaseDesc: "ケース（質問→最適回答）を登録",
      trainerCaseQuestion: "質問",
      trainerCaseAnswer: "最適回答",
      trainerCaseSave: "保存",
      trainerCaseEmpty: "まだケースがありません。",
      trainerCaseDelete: "削除",
      trainerCaseDeleteConfirm: "このケースを削除しますか？",

      theme: "テーマ",
      themeSystem: "システム",
      themeLight: "ライト",
      themeDark: "ダーク",

      language: "言語",
      langJa: "日本語",
      langEn: "English (US)",

      sendMode: "AUREAへの送信方法",
      sendCmdEnter: "⌘ + Enterで送信（Enterは改行）",
      sendEnter: "Enterで送信（Shift + Enterで改行）",

      dataStorage: "会話とデータの保存先",
      storageCloud: "クラウド",
      storageLocal: "端末内",

      /* ===== Library view ===== */
      librarySub: "会話内で作成された画像がここに保存されます",
      libraryEmpty: "まだ保存された画像がありません。",

      /* ===== Search view ===== */
      searchTitle: "検索結果",
      searchPrompt: "検索語を入力してください",
      searchNoMatch: "一致する会話が見つかりませんでした。",
      searchSubPrefix: "「",
      searchSubMid: "」の検索結果（",
      searchSubSuffix: "件）",

      /* ===== Confirm / Prompt ===== */
      confirmLogout: "ログアウトしますか？",
      confirmDelete: "削除しますか？",
      confirmDeleteProject: "プロジェクトを削除しますか？",
      confirmDeleteChat: "チャットを削除しますか？",
      confirmDeleteImage: "この画像を削除しますか？",
      confirmCreateProject: "プロジェクトを作成しますか？",
      confirmDeleteAllChats: "すべてのチャットを削除しますか？",
      confirmRevokeDevice: "この端末を解除しますか？",

      promptNewName: "新しい名前",
      promptSaasName: "SaaS名",
      promptNewEmail: "新しいメールアドレス",

      confirmTitle: "確認",
      cancel: "キャンセル",
      ok: "OK",
      areYouSure: "よろしいですか？",

      open: "開く",
      delete: "削除",

      project: "プロジェクト",
      chat: "チャット",
      global: "グローバル",

      displayName: "表示名",
      userName: "ユーザー名",
      userHandleOptional: "@handle（任意）",
      currentPlan: "現在のプラン",
      billing: "請求情報",
      emailAddress: "登録メールアドレス",
      change: "変更",
      trustedDevices: "信頼できるデバイス",
      revokeDevice: "この端末を解除",

      planListTitle: "プラン一覧",
      planSelect: "選択",
      perMonth: "/month",
      planFreeDesc: "機能制限あり・お試し利用",
      planProDesc: "機能制限解放・個人クリエーター向け",
      planTeamDesc: "チーム運用・３ライセンス分",
      planEnterpriseDesc: "企業向け・社内AI機能解放",
      planPriceTbd: "¥--",
      planPaidNote: "Free 以外のプランは有料です。\nプランを選択すると料金に同意した上で変更されます",

      googleConnectedAlert: "Google アカウントの連携が完了しました",
      googleConnectFailedAlert: "Google 連携に失敗しました: {err}",

      regulations: "規約・規定",
      tokusho: "特定商取引法に基づく表記",
      terms: "利用規約",
      privacy: "プライバシーポリシー",

      aiStack: "AI Stack",
      aiStackDesc: "展開中のAI / 最新Ver, / 稼働条件",
      listTable: "一覧表",
      ai: "AI",
      ver: "Ver,",
      condition: "稼働条件"
    },

    en: {
      /* ===== Sidebar / Main ===== */
      newChat: "New chat",
      threadNew: "New chat",
      titleMatch: "(Title match)",
      library: "Library",
      images: "Library",
      projects: "Projects",
      chats: "Chats",
      search: "Search",
      menuRename: "Rename",
      menuDelete: "Delete",
      share: "Share",

      /* ===== Ask bar ===== */
      options: "Options",
      addPhotoFile: "Add photos & files",
      createImage: "Create an image",
      input: "Input",
      mic: "Microphone (voice input)",
      voice: "Use voice mode",
      send: "Send",
      stop: "Stop",
      askNote: "AUREA aggregates/analyzes/judges/summarizes information from multiple AI searches, but it may not be accurate. Please verify important information.",
      promptEmpty: "(Empty)",
      statusAnalyzing: "Analyzing",
      statusGenerating: "Generating answer",
      aureaPrefix: "(AUREA)",
      replyPlaceholder: "This will be connected to /api/chat later.",
      imageSaved: "(Image saved)",
      imageSavedInLibrary: "\"{images}\" → saved to your library.",

      /* ===== Settings ===== */
      settings: "Settings",
      logout: "Log out",
      general: "General",
      generalDesc: "Basic device settings",
      theme: "Theme",
      themeSystem: "System",
      themeLight: "Light",
      themeDark: "Dark",
      language: "Language",
      langJa: "Japanese",
      langEn: "English (US)",
      sendMode: "Send mode",
      sendCmdEnter: "Send with ⌘ + Enter (Enter for newline)",
      sendEnter: "Send with Enter (Shift+Enter for newline)",

      apps: "Apps",
      appsDesc: "Connect SaaS and optionally set up API connections",

      data: "Data",
      dataDesc: "Data management and storage",
      dataStorage: "Chat & data storage",
      dataNowCloud: "Now: Cloud",
      dataNowLocal: "Now: Local",
      storageCloud: "Cloud",
      storageLocal: "Local",
      deleteAllChats: "Delete all chats",

      trainer: "AUREA Data Trainer",
      trainerDesc: "Train your internal AI to improve workflow efficiency",
      trainerSection: "Train AUREA (AET)",
      trainerSectionDesc: "Register “If the question is like this, use this answer” cases to improve your internal AI.",
      trainerAddCase: "Add case",
      trainerAddCaseDesc: "Register a case (question → best answer)",
      trainerCaseQuestion: "Question",
      trainerCaseAnswer: "Best answer",
      trainerCaseSave: "Save",
      trainerCaseEmpty: "No cases yet.",
      trainerCaseDelete: "Delete",
      trainerCaseDeleteConfirm: "Delete this case?",

      accountSecurity: "Account & security",
      accountDesc: "User information and security details",

      addSaas: "Add SaaS",
      addCustom: "Add custom",
      connected: "Connected",
      notConnected: "Not connected",
      saasCustom: "Custom SaaS",
      saasNoMatch: "No matching SaaS.",
      confirmReconnectGoogle: "Reconnect Google?",
      confirmConnectGoogle: "Connect Google account?",
      confirmConnectSaas: "Connect {name}?",
      confirmDisconnectSaas: "Disconnect {name}?",
      saasName: "SaaS name",
      saasNamePh: "e.g., Custom CRM",
      apiBaseUrl: "API Base URL",
      apiBaseUrlPh: "https://api.example.com",
      authMode: "Auth method",
      authApiKey: "API Key",
      authBearer: "Bearer Token",
      apiToken: "API Key / Token",
      apiTokenPh: "********",
      save: "Save",
      createProject: "Create project",
      projectName: "Project name",

      /* ===== Library view ===== */
      librarySub: "Images created in chats are saved here.",
      libraryEmpty: "No saved images yet.",

      /* ===== Search view ===== */
      searchTitle: "Search results",
      searchPrompt: "Type to search",
      searchNoMatch: "No matching chats found.",
      searchSubPrefix: "“",
      searchSubMid: "” results (",
      searchSubSuffix: " results)",

      /* ===== Confirm / Prompt ===== */
      confirmLogout: "Log out?",
      confirmDelete: "Delete?",
      confirmDeleteProject: "Delete this project?",
      confirmDeleteChat: "Delete this chat?",
      confirmDeleteImage: "Delete this image?",
      confirmCreateProject: "Create project?",
      confirmDeleteAllChats: "Delete all chats?",
      confirmRevokeDevice: "Revoke this device?",
      promptNewName: "New name",
      promptSaasName: "SaaS name",
      promptNewEmail: "New email address",
      confirmTitle: "Confirm",
      cancel: "Cancel",
      ok: "OK",
      areYouSure: "Are you sure?",
      open: "Open",
      delete: "Delete",
      project: "Project",
      chat: "Chat",
      global: "Global",

      /* ===== Account ===== */
      displayName: "Display name",
      userName: "Username",
      userHandleOptional: "@handle (optional)",
      currentPlan: "Current plan",
      billing: "Billing",
      emailAddress: "Email address",
      change: "Change",
      trustedDevices: "Trusted devices",
      revokeDevice: "Revoke this device",
      planListTitle: "Plans",
      planSelect: "Select",
      perMonth: "/month",
      planFreeDesc: "Light personal use",
      planProDesc: "Power personal use",
      planTeamDesc: "Team",
      planEnterpriseDesc: "Enterprise",
      planPriceTbd: "$--",
      planPaidNote: "Plans other than Free are paid.\nBy selecting a plan, you agree to the pricing.",
      googleConnectedAlert: "Google account connected",
      googleConnectFailedAlert: "Google connect failed: {err}",
      regulations: "Regulations",
      tokusho: "Disclosure based on the Specified Commercial Transaction Act",
      terms: "Terms",
      privacy: "Privacy Policy",
      aiStack: "AI Stack",
      aiStackDesc: "Active AIs / Latest ver / Conditions",
      listTable: "List",
      ai: "AI",
      ver: "Ver,",
      condition: "Condition"
    }
  };

  const normalizeLang = (raw) => {
    const v = String(raw || "").trim().toLowerCase();
    if (v === "ja" || v.startsWith("ja")) return "ja";
    if (v === "en" || v.startsWith("en")) return "en";
    return "ja"; // AUREA: default ja
  };

  const tr = (state, key) => {
    const lang = normalizeLang(state?.settings?.language || "ja");
    return I18N[lang]?.[key] || I18N.ja?.[key] || I18N.en?.[key] || key;
  };

  window.AUREA_I18N = { I18N, normalizeLang, tr };
})();
