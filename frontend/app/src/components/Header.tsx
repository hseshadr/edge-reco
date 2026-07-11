interface HeaderProps {
	query: string;
	onQueryChange: (value: string) => void;
	categories: string[];
	activeCategory: string | null;
	onSelectCategory: (category: string | null) => void;
	cartCount: number;
}

export function Header({
	query,
	onQueryChange,
	categories,
	activeCategory,
	onSelectCategory,
	cartCount,
}: HeaderProps) {
	return (
		<header className="nimbus-header">
			<div className="nimbus-header__bar">
				<div className="wordmark">
					<span className="wordmark__name">
						Nimbus<span className="wordmark__dot">.</span>
					</span>
					<span className="wordmark__tag">the everything store</span>
				</div>

				<div className="search">
					<svg
						className="search__icon"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						aria-hidden="true"
					>
						<circle
							cx="11"
							cy="11"
							r="7"
							stroke="currentColor"
							strokeWidth="2"
						/>
						<path
							d="M20 20l-3.5-3.5"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
						/>
					</svg>
					<input
						className="search__input"
						type="search"
						placeholder="Search the everything store…"
						value={query}
						onChange={(e) => onQueryChange(e.target.value)}
						aria-label="Search products"
					/>
				</div>

				<div className="session-pill">
					<span className="session-pill__dot" />
					on-device personalization
				</div>

				<a
					className="header-gh"
					href="https://github.com/hseshadr/edge-reco"
					target="_blank"
					rel="noreferrer"
					title="EdgeReco is open source — view hseshadr/edge-reco on GitHub"
				>
					Open source
					<span aria-hidden="true"> ↗</span>
				</a>

				{cartCount > 0 && (
					<span
						className="cart-pill"
						title={`${cartCount} added to cart this session (demo signal — nothing is purchased)`}
					>
						<svg
							width="15"
							height="15"
							viewBox="0 0 24 24"
							fill="none"
							aria-hidden="true"
						>
							<path
								d="M3 4h2.4l2.3 11.2a1.6 1.6 0 0 0 1.6 1.3h7.6a1.6 1.6 0 0 0 1.6-1.2L20.5 8H6"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
							<circle cx="10" cy="20" r="1.4" fill="currentColor" />
							<circle cx="17" cy="20" r="1.4" fill="currentColor" />
						</svg>
						{cartCount}
					</span>
				)}
			</div>

			{categories.length > 0 && (
				<nav className="chips" aria-label="Categories">
					<button
						type="button"
						className={`chip${activeCategory === null ? " chip--active" : ""}`}
						onClick={() => onSelectCategory(null)}
					>
						All
					</button>
					{categories.map((category) => (
						<button
							key={category}
							type="button"
							className={`chip${
								activeCategory === category ? " chip--active" : ""
							}`}
							onClick={() => onSelectCategory(category)}
						>
							{category}
						</button>
					))}
				</nav>
			)}
		</header>
	);
}
