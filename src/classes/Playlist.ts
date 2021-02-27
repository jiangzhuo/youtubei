import { Thumbnails, BaseAttributes, VideoCompact, Channel, Base, Client } from ".";
import { YoutubeRawData } from "../common";
import { I_END_POINT } from "../constants";

/** @hidden */
interface PlaylistAttributes extends BaseAttributes {
	title: string;
	videoCount: number;
	viewCount: number;
	lastUpdatedAt: string;
	channel?: Channel;
	videos: VideoCompact[];
}

/** Represents a Playlist, usually returned from `client.getPlaylist()` */
export default class Playlist extends Base implements PlaylistAttributes {
	/** The title of this playlist */
	title!: string;
	/** How many videos in this playlist */
	videoCount!: number;
	/** How many viewers does this playlist have */
	viewCount!: number;
	/** Last time this playlist is updated */
	lastUpdatedAt!: string;
	/** The channel that made this playlist */
	channel?: Channel;
	/** Videos in the playlist */
	videos!: VideoCompact[];

	private _continuation!: string;

	/** @hidden */
	constructor(playlist: Partial<Playlist> = {}) {
		super();
		Object.assign(this, playlist);
	}

	/**
	 * Load this instance with raw data from Youtube
	 *
	 * @hidden
	 */
	load(data: YoutubeRawData): Playlist {
		const sidebarRenderer = data.sidebar.playlistSidebarRenderer.items;
		const primaryRenderer = sidebarRenderer[0].playlistSidebarPrimaryInfoRenderer;

		// Basic information
		this.id = primaryRenderer.title.runs[0].navigationEndpoint.watchEndpoint.playlistId;
		this.title = primaryRenderer.title.runs[0].text;

		const { stats } = primaryRenderer;
		if (primaryRenderer.stats.length === 3) {
			this.videoCount = Playlist.getSideBarInfo(stats[0], true);
			this.viewCount = Playlist.getSideBarInfo(stats[1], true);
			this.lastUpdatedAt = Playlist.getSideBarInfo(stats[2], false);
		} else if (stats.length === 2) {
			this.videoCount = Playlist.getSideBarInfo(stats[0], true);
			this.lastUpdatedAt = Playlist.getSideBarInfo(stats[1], false);
		}

		// Videos
		const playlistContents =
			data.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content
				.sectionListRenderer.contents[0].itemSectionRenderer.contents[0]
				.playlistVideoListRenderer.contents;

		this.videos = Playlist.getVideos(playlistContents, this.client);

		// Video Continuation Token
		this._continuation =
			playlistContents[100]?.continuationItemRenderer.continuationEndpoint.continuationCommand.token;

		// Channel
		const videoOwner =
			sidebarRenderer[1]?.playlistSidebarSecondaryInfoRenderer.videoOwner || undefined;
		if (videoOwner) {
			const { title, thumbnail } = videoOwner.videoOwnerRenderer;
			this.channel = new Channel({
				id: title.runs[0].navigationEndpoint.browseEndpoint.browseId,
				name: title.runs[0].text,
				thumbnails: new Thumbnails().load(thumbnail.thumbnails),
				url:
					"https://www.youtube.com" +
					title.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url,
				client: this.client,
			});
		}

		return this;
	}

	/**
	 * Load next 100 videos of the playlist, and push the loaded videos to {@link Playlist.videos}
	 *
	 * @example
	 * ```js
	 * const playlist = await youtube.getPlaylist(PLAYLIST_ID);
	 * console.log(playlist.videos) // first 100 videos
	 *
	 * let newVideos = await playlist.next();
	 * console.log(newVideos) // 100 loaded videos
	 * console.log(playlist.videos) // first 200 videos
	 *
	 * await playlist.next(0); // load the rest of the videos in the playlist
	 * ```
	 *
	 * @param count How many times to load the next videos. Set 0 to load all videos (might take a while on a large playlist!)
	 */
	async next(count = 1): Promise<VideoCompact[]> {
		const newVideos: VideoCompact[] = [];
		for (let i = 0; i < count || count == 0; i++) {
			if (!this._continuation) break;
			const response = await this.client.http.post(`${I_END_POINT}/browse`, {
				data: { continuation: this._continuation },
			});

			const playlistContents =
				response.data.onResponseReceivedActions[0].appendContinuationItemsAction
					.continuationItems;
			newVideos.push(...Playlist.getVideos(playlistContents, this.client));

			this._continuation =
				playlistContents[100]?.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
		}

		this.videos.push(...newVideos);
		return newVideos;
	}

	/**
	 * Get compact videos
	 *
	 * @param playlistContents raw object from youtubei
	 */
	private static getVideos(playlistContents: YoutubeRawData, client: Client): VideoCompact[] {
		const videosRenderer = playlistContents.map((c: YoutubeRawData) => c.playlistVideoRenderer);
		const videos = [];
		for (const videoRenderer of videosRenderer) {
			if (!videoRenderer) continue;
			videos.push(new VideoCompact({ client }).load(videoRenderer));
		}
		return videos;
	}

	private static getSideBarInfo<T extends boolean = true>(
		stats: YoutubeRawData,
		parseInt: T
	): T extends true ? number : string {
		let data;
		if ("runs" in stats) data = stats.runs.map((r: Record<string, string>) => r.text).join("");
		else data = stats.simpleText.replace(/[^0-9]/g, "");

		if (parseInt) data = +data.replace(/[^0-9]/g, "");
		return data;
	}
}
