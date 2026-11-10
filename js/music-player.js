(function () {
  'use strict';

  var players = document.querySelectorAll('[data-music-player]');

  Array.prototype.forEach.call(players, function (player) {
    var audio = player.querySelector('.music-player__audio');
    var toggle = player.querySelector('.music-player__toggle');
    var next = player.querySelector('.music-player__next');
    var playlist = player.querySelector('.music-player__playlist');
    var title = player.querySelector('[data-music-title]');
    var artist = player.querySelector('[data-music-artist]');
    var status = player.querySelector('[data-music-status]');
    var playAttempt = 0;

    if (!audio || !toggle || !next || !playlist || !playlist.options.length) return;

    var getTrack = function () {
      return playlist.options[playlist.selectedIndex];
    };

    var trackName = function (track) {
      return track.getAttribute('data-title') + ' by ' + track.getAttribute('data-artist');
    };

    var setPlaybackState = function (playing) {
      player.classList.toggle('is-playing', playing);
      player.classList.remove('is-loading');
      toggle.setAttribute('aria-pressed', playing ? 'true' : 'false');
      toggle.setAttribute('aria-label', (playing ? 'Pause ' : 'Play ') + trackName(getTrack()));
      status.textContent = playing ? 'Now playing' : 'Music ready';
    };

    var showError = function () {
      player.classList.remove('is-loading', 'is-playing');
      player.classList.add('has-error');
      toggle.setAttribute('aria-pressed', 'false');
      toggle.setAttribute('aria-label', 'Retry ' + trackName(getTrack()));
      status.textContent = 'Playback unavailable';
    };

    var updateTrack = function () {
      var track = getTrack();
      title.textContent = track.getAttribute('data-title');
      artist.textContent = track.getAttribute('data-artist');
      player.classList.remove('has-error');
      setPlaybackState(false);
    };

    var playSelected = function () {
      var track = getTrack();
      var source = track.getAttribute('data-src');

      if (!source) {
        showError();
        return;
      }

      if (audio.getAttribute('src') !== source) {
        audio.setAttribute('src', source);
      }

      player.classList.remove('has-error');
      player.classList.add('is-loading');
      status.textContent = 'Loading';

      var attempt = ++playAttempt;
      var playRequest;
      try {
        playRequest = audio.play();
      } catch (error) {
        showError();
        return;
      }

      if (playRequest && typeof playRequest.catch === 'function') {
        playRequest.catch(function (error) {
          if (attempt !== playAttempt || (error && error.name === 'AbortError')) return;
          showError();
        });
      }
    };

    var selectTrack = function (index, resumePlayback) {
      playAttempt += 1;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      playlist.selectedIndex = index;
      updateTrack();

      if (resumePlayback) playSelected();
    };

    toggle.addEventListener('click', function () {
      if (audio.paused) {
        playSelected();
      } else {
        playAttempt += 1;
        audio.pause();
      }
    });

    next.addEventListener('click', function () {
      var shouldResume = !audio.paused;
      var nextIndex = (playlist.selectedIndex + 1) % playlist.options.length;
      selectTrack(nextIndex, shouldResume);
    });

    playlist.addEventListener('change', function () {
      var shouldResume = !audio.paused;
      selectTrack(playlist.selectedIndex, shouldResume);
    });

    audio.addEventListener('play', function () {
      setPlaybackState(true);
    });

    audio.addEventListener('pause', function () {
      if (!audio.ended) setPlaybackState(false);
    });

    audio.addEventListener('ended', function () {
      if (playlist.options.length > 1) {
        var nextIndex = (playlist.selectedIndex + 1) % playlist.options.length;
        selectTrack(nextIndex, true);
      } else {
        audio.currentTime = 0;
        setPlaybackState(false);
      }
    });

    audio.addEventListener('error', showError);
    updateTrack();
  });
})();
