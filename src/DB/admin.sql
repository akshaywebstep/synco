INSERT INTO `admin_roles` (`id`, `role`, `createdAt`, `updatedAt`) VALUES
(1, 'Admin', '2025-07-15 12:16:09', '2025-07-15 12:16:09'),
(2, 'Member', '2025-07-15 12:16:09', '2025-07-15 12:16:09');

INSERT INTO `admins` (`id`, `profile`, `firstName`, `lastName`, `email`, `password`, `passwordHint`, `position`, `phoneNumber`, `roleId`, `country_id`, `state_id`, `city_id`, `city`, `resetOtp`, `resetOtpExpiry`, `status`, `createdAt`, `updatedAt`) VALUES
(1, NULL, 'Rohit Webstep', NULL, 'rohitwebstep@gmail.com', '$2b$10$uNiJ2v/xH/rW5NgLht8mb.6vQf79gtao1O74lOpyWb8nvDVgqJSbO', NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, 'active', '2025-07-09 11:20:02', '2025-07-09 11:20:02'),
(2, NULL, 'Shikha Webstep', NULL, 'shikhawebstep@gmail.com', '$2b$10$JXctFS7vhPPvbFcBrYjnSOZSvd8dfnaVZvpu1IYWpaHDgrGTgJbGe', NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, 'active', '2025-07-09 11:20:10', '2025-07-09 11:20:10'),
(3, NULL, 'Vnash Webstep', NULL, 'vanshwebstep@gmail.com', '$2b$10$3PhccuJCOhtQIlvgXzR89OMXBkKjbvnF00IjlDTajiNgvZcnyAHge', NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, 'active', '2025-07-09 11:20:18', '2025-07-09 11:20:18');