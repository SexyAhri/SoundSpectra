use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlayMode {
    #[default]
    Sequence,
    Loop,
    Single,
    Shuffle,
}
impl PlayMode {
    pub fn cycle(self) -> Self {
        match self {
            Self::Sequence => Self::Loop,
            Self::Loop => Self::Single,
            Self::Single => Self::Shuffle,
            Self::Shuffle => Self::Sequence,
        }
    }
}

#[derive(Clone)]
pub struct Order {
    history: Vec<usize>,
    bag: Vec<usize>,
    seed: u64,
}
impl Default for Order {
    fn default() -> Self {
        Self {
            history: vec![],
            bag: vec![],
            seed: super::now().max(1),
        }
    }
}
impl Order {
    pub fn peek(&mut self, mode: PlayMode, len: usize, index: usize) -> Option<usize> {
        if mode == PlayMode::Shuffle && self.bag.is_empty() {
            let mut prepared = self.clone();
            let next = prepared.next(mode, len, index, true)?;
            prepared.bag.push(next);
            self.bag = prepared.bag;
            self.seed = prepared.seed;
        }
        self.clone().next(mode, len, index, true)
    }
    pub fn can_previous(&self, mode: PlayMode, len: usize, index: usize) -> bool {
        len > 0
            && match mode {
                PlayMode::Sequence => index > 0,
                PlayMode::Shuffle => !self.history.is_empty(),
                _ => true,
            }
    }
    pub fn can_next(mode: PlayMode, len: usize, index: usize) -> bool {
        len > 0 && (mode != PlayMode::Sequence || index + 1 < len)
    }
    pub fn next(&mut self, mode: PlayMode, len: usize, index: usize, ended: bool) -> Option<usize> {
        if len == 0 || index >= len {
            return None;
        }
        let next = match mode {
            PlayMode::Sequence => (index + 1 < len).then_some(index + 1)?,
            PlayMode::Single if ended => index,
            PlayMode::Loop | PlayMode::Single => (index + 1) % len,
            PlayMode::Shuffle if len == 1 => index,
            PlayMode::Shuffle => {
                if self.bag.is_empty() {
                    self.bag = (0..len).filter(|n| *n != index).collect();
                    for i in (1..self.bag.len()).rev() {
                        self.seed ^= self.seed << 13;
                        self.seed ^= self.seed >> 7;
                        self.seed ^= self.seed << 17;
                        self.bag.swap(i, self.seed as usize % (i + 1));
                    }
                }
                self.bag.pop()?
            }
        };
        if mode == PlayMode::Shuffle && next != index {
            self.history.push(index);
            if self.history.len() > 4096 {
                self.history.remove(0);
            }
        }
        Some(next)
    }
    pub fn previous(&mut self, mode: PlayMode, len: usize, index: usize) -> Option<usize> {
        if len == 0 || index >= len {
            return None;
        }
        match mode {
            PlayMode::Sequence => index.checked_sub(1),
            PlayMode::Shuffle => {
                let previous = self.history.pop()?;
                self.bag.retain(|n| *n != previous && *n != index);
                self.bag.push(index);
                Some(previous)
            }
            _ => Some((index + len - 1) % len),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_previews_do_not_consume_random_order_or_previous_history() {
        let mut q = Order::default();
        let candidate = q.peek(PlayMode::Shuffle, 8, 0).unwrap();
        for _ in 0..100 {
            assert_eq!(q.peek(PlayMode::Shuffle, 8, 0), Some(candidate));
            assert!(q.history.is_empty());
        }
        assert_eq!(q.next(PlayMode::Shuffle, 8, 0, true), Some(candidate));
        assert_eq!(q.previous(PlayMode::Shuffle, 8, candidate), Some(0));
        assert_eq!(q.next(PlayMode::Shuffle, 8, 0, false), Some(candidate));
    }
    #[test]
    fn sequence_loop_and_single_distinguish_manual_next_from_track_end() {
        let mut q = Order::default();
        assert_eq!(q.next(PlayMode::Sequence, 3, 2, true), None);
        assert_eq!(q.next(PlayMode::Loop, 3, 2, true), Some(0));
        assert_eq!(q.next(PlayMode::Single, 3, 1, true), Some(1));
        assert_eq!(q.next(PlayMode::Single, 3, 1, false), Some(2));
        assert_eq!(q.previous(PlayMode::Loop, 3, 0), Some(2));
        assert_eq!(q.next(PlayMode::Shuffle, 0, 0, true), None);
        assert_eq!(q.next(PlayMode::Shuffle, 1, 0, true), Some(0));
    }
    #[test]
    fn shuffle_visits_each_remaining_track_then_previous_retraces_history() {
        let mut q = Order::default();
        let mut index = 0;
        let mut visited = vec![0];
        for _ in 0..7 {
            index = q.next(PlayMode::Shuffle, 8, index, true).unwrap();
            visited.push(index);
        }
        let last = index;
        let previous = visited[6];
        visited.sort_unstable();
        visited.dedup();
        assert_eq!(visited.len(), 8);
        assert_eq!(q.previous(PlayMode::Shuffle, 8, index), Some(previous));
        assert_eq!(q.next(PlayMode::Shuffle, 8, previous, false), Some(last));
    }
}
