(() => {
  const activeAnimations = new WeakMap();
  const ANIMATION_DURATION_MS = 1800;
  const REDUCED_MOTION_DURATION_MS = 450;

  function animate(element, score) {
    const previousAnimation = activeAnimations.get(element);
    if (previousAnimation) {
      window.cancelAnimationFrame(previousAnimation.frame);
      window.clearTimeout(previousAnimation.timeout);
      previousAnimation.resolve();
      activeAnimations.delete(element);
    }

    element.classList.remove("is-final");
    if (!Number.isFinite(score)) {
      element.textContent = "--";
      element.removeAttribute("aria-label");
      return Promise.resolve();
    }

    const finalScore = Math.round(score);
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? REDUCED_MOTION_DURATION_MS
      : ANIMATION_DURATION_MS;
    element.textContent = "0";
    element.setAttribute("aria-label", `${finalScore} points`);

    return new Promise((resolve) => {
      const animation = { frame: 0, resolve, timeout: 0, startTime: null };
      activeAnimations.set(element, animation);

      const finish = () => {
        if (activeAnimations.get(element) !== animation) return;
        window.cancelAnimationFrame(animation.frame);
        window.clearTimeout(animation.timeout);
        activeAnimations.delete(element);
        if (element.isConnected) {
          element.textContent = String(finalScore);
          element.classList.add("is-final");
        }
        resolve();
      };

      const update = (timestamp) => {
        if (activeAnimations.get(element) !== animation) {
          return;
        }

        if (!element.isConnected) {
          window.clearTimeout(animation.timeout);
          activeAnimations.delete(element);
          resolve();
          return;
        }

        animation.startTime ??= timestamp;
        const progress = Math.min(
          (timestamp - animation.startTime) / duration,
          1,
        );
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        element.textContent = String(
          progress === 1 ? finalScore : Math.floor(finalScore * easedProgress),
        );

        if (progress === 1) {
          finish();
          return;
        }

        animation.frame = window.requestAnimationFrame(update);
      };

      animation.timeout = window.setTimeout(finish, duration + 100);
      animation.frame = window.requestAnimationFrame(update);
    });
  }

  window.SDKaraokeScoreCounter = { animate };
})();
