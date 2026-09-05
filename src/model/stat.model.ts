export type StatModel =
	| {
			path: string
			basename: string
			isDir: true
			isDeleted: boolean
			mtime?: number			
			ctime?:number
			contentHash?: string
	  }
	| {
			path: string
			basename: string
			isDir: false
			isDeleted: boolean
			mtime: number
			size: number
			ctime?:number
			contentHash?: string
	  }
