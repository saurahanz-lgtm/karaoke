(() => {
  const STORAGE_PREFIX = "sdkaraokeOnboarding:v1:";
  const initializedUsers = new Set();
  let activeTour = null;

  const performerSteps = [
    {
      selector: "#userDisplayName",
      title: "Your performer account",
      description:
        "Your signed-in name appears here. Use Disconnect when you are finished.",
    },
    {
      selector: "#karaokeRoomStatus",
      title: "Your karaoke room",
      description:
        "Check the room connection status here. Your song requests go to this room's shared queue.",
    },
    {
      selector: ".controls",
      title: "Playback controls",
      description:
        "Control playback on the shared display. These controls need an active connection to the room.",
    },
    {
      selector: "#volumeSlider",
      title: "Room volume",
      description:
        "Adjust the shared display's volume here. You can also use the device's own volume buttons.",
    },
    {
      selector: "#searchForm",
      title: "Find a karaoke song",
      description:
        "Search by song title or artist. Choose Reserve on a result to add it to the room queue.",
    },
    {
      selector: "#favoritesToggleButton",
      title: "Saved favorites",
      description:
        "Save songs you like and return to them quickly from this button.",
    },
    {
      selector: "#reservedSongs",
      title: "Your room's reserved songs",
      description:
        "See the current and upcoming songs reserved for everyone in this room.",
    },
    {
      selector: "#performerPhoneDisplayToggle",
      title: "Performer phone display",
      description:
        "Open the karaoke display on your phone. This is separate from the shared TV display.",
    },
  ];

  const indexSteps = [
    {
      selector: ".home-container",
      title: "Choose your portal",
      description:
        "Welcome to SD Karaoke. This page is where performers and administrators begin.",
    },
    {
      selector: ".role-container",
      title: "Select your role",
      description:
        "Choose System Administration to manage the system, or Karaoke Performer to join a room and reserve songs.",
    },
    {
      selector: ".performer-room-status",
      title: "Check room availability",
      description:
        "Performers can scan the room QR code or enter its Room ID here, then check room availability before joining.",
      onEnter: () => window.openPerformerLogin(),
      onExit: () => window.closeLoginModal(),
    },
    {
      selector: ".access-portal-display",
      title: "Open the shared display",
      description:
        "Open Karaoke Display on the TV or shared screen so performers can scan its room QR code.",
    },
    {
      selector: 'a.access-portal-guide[href="user-guide.html"]',
      title: "Find the user guide",
      description:
        "Open the quick guide any time for step-by-step help with joining a room, reserving songs, and using the display.",
    },
  ];

  const adminSteps = [
    {
      selector: "#dashboardSection .dashboard-stats",
      title: "System overview",
      description:
        "The dashboard summarizes accounts, online users, active rooms, and available rooms.",
      view: "dashboard",
    },
    {
      selector: "#dashboardRoomStatus",
      title: "Room status",
      description:
        "See room occupancy at a glance. Use View all or the sidebar to open room management.",
      view: "dashboard",
    },
    {
      selector: "#accountRequestsPanel",
      title: "Account management",
      description:
        "Review account requests and manage user accounts from this section.",
      view: "users",
    },
    {
      selector: "#roomsSection .stats-grid",
      title: "Karaoke rooms",
      description:
        "Monitor rooms and connected devices. Admins can add rooms; managers can monitor and manage the rooms they are allowed to access.",
      view: "rooms",
    },
    {
      selector: "#roomRequestsSection .account-request-filters",
      title: "Room requests",
      description:
        "Review room requests and time-extension requests, then switch between pending items and request history.",
      view: "requests",
    },
    {
      selector: "#displayControlSection .display-control-card",
      title: "Display controls",
      description:
        "Admins can manage overall and room-specific karaoke display availability here.",
      view: "display",
      adminOnly: true,
    },
    {
      selector: "#adminProfileToggle",
      title: "Your account",
      description:
        "Open your account menu here when you need to log out. You can return to the dashboard from the sidebar.",
      view: "dashboard",
    },
  ];

  function canUseStep(step, role) {
    if (step.adminOnly && role !== "admin") return false;
    if (
      step.view &&
      typeof window.canAccessAdminView === "function" &&
      !window.canAccessAdminView(step.view)
    ) {
      return false;
    }
    return true;
  }

  function setTourCompleted(key) {
    try {
      localStorage.setItem(key, "completed");
    } catch (error) {
      console.warn("Could not save onboarding completion:", error.message);
    }
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function createTour(steps, storageKey) {
    const previousFocus = document.activeElement;
    const root = createElement("div", "onboarding-tour");
    root.id = "sdkaraokeOnboardingTour";
    root.setAttribute("aria-label", "SD Karaoke onboarding tour");

    const panels = ["top", "left", "right", "bottom"].map((position) => {
      const panel = createElement(
        "div",
        `onboarding-tour__shade onboarding-tour__shade--${position}`,
      );
      panel.setAttribute("aria-hidden", "true");
      root.appendChild(panel);
      return panel;
    });

    const highlight = createElement("div", "onboarding-tour__highlight");
    highlight.setAttribute("aria-hidden", "true");
    root.appendChild(highlight);

    const dialog = createElement("section", "onboarding-tour__dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "onboardingTourTitle");
    dialog.setAttribute("aria-describedby", "onboardingTourDescription");
    dialog.tabIndex = -1;
    root.appendChild(dialog);
    document.body.appendChild(root);

    let stepIndex = -1;
    let currentTarget = null;
    let currentView = "";
    let activeStepCleanup = null;

    const closeTour = (completed) => {
      document.removeEventListener("click", blockOutsideClick, true);
      document.removeEventListener("pointerdown", blockOutsideClick, true);
      document.removeEventListener("keydown", handleKeydown, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      activeStepCleanup?.();
      root.remove();
      activeTour = null;
      if (completed) setTourCompleted(storageKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };

    const blockOutsideClick = (event) => {
      if (dialog.contains(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeTour(true);
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.querySelectorAll("button:not([disabled])"),
      );
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    function reposition() {
      if (!currentTarget?.isConnected) return;
      positionTour(currentTarget, panels, highlight, dialog, stepIndex, steps);
    }

    const addAction = (label, className, action) => {
      const button = createElement("button", className, label);
      button.type = "button";
      button.addEventListener("click", action);
      return button;
    };

    const showWelcome = () => {
      currentTarget = null;
      currentView = "";
      highlight.hidden = true;
      panels.forEach((panel, index) => {
        panel.style.cssText = "";
        panel.hidden = index !== 0;
      });
      panels[0].style.cssText = "inset:0;width:100%;height:100%";
      dialog.className = "onboarding-tour__dialog onboarding-tour__dialog--welcome";
      dialog.replaceChildren();

      const eyebrow = createElement(
        "p",
        "onboarding-tour__eyebrow",
        "FIRST-TIME GUIDE",
      );
      const title = createElement("h2", "", "Welcome to SD Karaoke!");
      title.id = "onboardingTourTitle";
      const description = createElement(
        "p",
        "onboarding-tour__description",
        "Let's take a quick tour to help you learn how to use the system.",
      );
      description.id = "onboardingTourDescription";
      const actions = createElement("div", "onboarding-tour__actions");
      actions.append(
        addAction(
          "Skip Tour",
          "onboarding-tour__button onboarding-tour__button--quiet",
          () => closeTour(true),
        ),
        addAction("Start Tour", "onboarding-tour__button", () => showStep(0)),
      );
      dialog.append(eyebrow, title, description, actions);
      dialog.focus();
      dialog.querySelector("button:last-child").focus();
    };

    async function showStep(requestedIndex) {
      activeStepCleanup?.();
      activeStepCleanup = null;
      let nextIndex = requestedIndex;
      while (nextIndex < steps.length) {
        const step = steps[nextIndex];
        if (step.onEnter) {
          step.onEnter();
          activeStepCleanup = step.onExit || null;
        }
        if (step.view && step.view !== currentView) {
          window.setAdminView?.(step.view);
          currentView = step.view;
        }
        const target = document.querySelector(step.selector);
        if (
          target &&
          target.isConnected &&
          target.getClientRects().length > 0 &&
          !target.closest("[hidden]")
        ) {
          stepIndex = nextIndex;
          currentTarget = target;
          target.scrollIntoView({ block: "center", behavior: "smooth" });
          await new Promise((resolve) => window.setTimeout(resolve, 120));
          if (!root.isConnected) return;
          dialog.className = "onboarding-tour__dialog";
          renderStep(step);
          positionTour(target, panels, highlight, dialog, stepIndex, steps);
          dialog.querySelector("button:last-child").focus();
          return;
        }
        activeStepCleanup?.();
        activeStepCleanup = null;
        console.warn("Onboarding tour target unavailable:", step.selector);
        nextIndex += 1;
      }
      closeTour(true);
    }

    const showNext = () => showStep(stepIndex + 1);
    const showPrevious = () => showStep(Math.max(0, stepIndex - 1));

    function renderStep(step) {
      dialog.replaceChildren();
      const progress = createElement(
        "p",
        "onboarding-tour__eyebrow",
        `STEP ${stepIndex + 1} OF ${steps.length}`,
      );
      const title = createElement("h2", "", step.title);
      title.id = "onboardingTourTitle";
      const description = createElement(
        "p",
        "onboarding-tour__description",
        step.description,
      );
      description.id = "onboardingTourDescription";
      const actions = createElement("div", "onboarding-tour__actions");
      const navigation = createElement("div", "onboarding-tour__navigation");
      if (stepIndex > 0) {
        navigation.append(
          addAction(
            "Back",
            "onboarding-tour__button onboarding-tour__button--quiet",
            showPrevious,
          ),
        );
      }
      navigation.append(
        addAction(
          stepIndex === steps.length - 1 ? "Finish" : "Next",
          "onboarding-tour__button",
          showNext,
        ),
      );
      actions.append(
        addAction(
          "Skip Tour",
          "onboarding-tour__button onboarding-tour__button--quiet",
          () => closeTour(true),
        ),
        navigation,
      );
      dialog.append(progress, title, description, actions);
    }

    document.addEventListener("click", blockOutsideClick, true);
    document.addEventListener("pointerdown", blockOutsideClick, true);
    document.addEventListener("keydown", handleKeydown, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);

    showWelcome();
    activeTour = { close: closeTour };
  }

  function positionTour(target, panels, highlight, dialog, stepIndex, steps) {
    const bounds = target.getBoundingClientRect();
    const margin = 6;
    const left = Math.max(8, bounds.left - margin);
    const top = Math.max(8, bounds.top - margin);
    const right = Math.min(window.innerWidth - 8, bounds.right + margin);
    const bottom = Math.min(window.innerHeight - 8, bounds.bottom + margin);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);

    panels.forEach((panel) => {
      panel.hidden = false;
    });
    panels[0].style.cssText = `left:0;top:0;width:100%;height:${top}px`;
    panels[1].style.cssText =
      `left:0;top:${top}px;width:${left}px;height:${height}px`;
    panels[2].style.cssText =
      `left:${right}px;top:${top}px;width:${Math.max(0, window.innerWidth - right)}px;height:${height}px`;
    panels[3].style.cssText =
      `left:0;top:${bottom}px;width:100%;height:${Math.max(0, window.innerHeight - bottom)}px`;

    highlight.hidden = false;
    highlight.style.cssText =
      `left:${left}px;top:${top}px;width:${width}px;height:${height}px;border-radius:${getComputedStyle(target).borderRadius || "8px"}`;
    dialog.style.visibility = "hidden";
    dialog.style.left = "16px";
    dialog.style.top = "16px";
    dialog.style.visibility = "visible";

    const dialogBounds = dialog.getBoundingClientRect();
    const horizontalInset = 16;
    const dialogLeft = Math.min(
      Math.max(horizontalInset, left),
      window.innerWidth - dialogBounds.width - horizontalInset,
    );
    const belowTop = bottom + 14;
    const aboveTop = top - dialogBounds.height - 14;
    const dialogTop =
      belowTop + dialogBounds.height <= window.innerHeight - 12
        ? belowTop
        : Math.max(12, aboveTop);

    dialog.style.left = `${dialogLeft}px`;
    dialog.style.top = `${dialogTop}px`;
    dialog.setAttribute(
      "aria-label",
      `Step ${stepIndex + 1} of ${steps.length}: ${dialog.querySelector("h2")?.textContent || ""}`,
    );
  }

  function start(user, experience) {
    if (activeTour) return;
    const username = String(user?.username || "").trim();
    const role = user?.role;
    const normalizedRole =
      experience === "performer"
        ? "performer"
        : ["admin", "room_manager"].includes(role)
          ? role
          : null;
    if (!username || !normalizedRole) {
      console.warn("Onboarding tour not started: missing valid signed-in user.");
      return;
    }

    const storageKey = `${STORAGE_PREFIX}${normalizedRole}:${encodeURIComponent(username.toLowerCase())}`;
    if (initializedUsers.has(storageKey)) return;
    initializedUsers.add(storageKey);

    try {
      if (localStorage.getItem(storageKey)) return;
    } catch (error) {
      console.warn("Could not read onboarding completion:", error.message);
    }

    const allSteps =
      normalizedRole === "performer" ? performerSteps : adminSteps;
    const steps = allSteps.filter((step) => canUseStep(step, normalizedRole));
    if (steps.length === 0) {
      console.warn("Onboarding tour not started: no steps available.");
      return;
    }
    createTour(steps, storageKey);
  }

  function startIndex() {
    if (activeTour) return;
    const storageKey = `${STORAGE_PREFIX}index`;
    if (initializedUsers.has(storageKey)) return;
    initializedUsers.add(storageKey);

    try {
      if (localStorage.getItem(storageKey)) return;
    } catch (error) {
      console.warn("Could not read onboarding completion:", error.message);
    }

    const steps = indexSteps.filter((step) => canUseStep(step, "index"));
    if (steps.length === 0) {
      console.warn("Index onboarding tour not started: no steps available.");
      return;
    }
    createTour(steps, storageKey);
  }

  window.SDKaraokeOnboarding = { start, startIndex };

  if (document.body.classList.contains("home-page")) {
    startIndex();
  }
})();
