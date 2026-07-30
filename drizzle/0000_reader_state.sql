CREATE TABLE IF NOT EXISTS `reader_state` (
  `user_email` text NOT NULL,
  `item_id` text NOT NULL,
  `is_read` integer DEFAULT 0 NOT NULL,
  `is_starred` integer DEFAULT 0 NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`user_email`, `item_id`),
  CHECK (`is_read` IN (0, 1)),
  CHECK (`is_starred` IN (0, 1))
);
